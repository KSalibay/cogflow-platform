import json

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion
from apps.results.models import ResultEnvelope
from apps.runs.models import RunSession
from apps.studies.models import Study
from project.api_serializers import (
    PublishConfigRequestSerializer,
    StartRunRequestSerializer,
    SubmitResultRequestSerializer,
)
from project.security import encrypt_payload, hash_identifier


def record_audit(action: str, resource_type: str, resource_id: str, metadata: dict | None = None) -> None:
    AuditEvent.objects.create(
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        metadata_json=metadata or {},
    )


class HealthView(APIView):
    def get(self, request):
        return Response({"ok": True})


class StudiesListView(APIView):
    def get(self, request):
        studies = []
        for study in Study.objects.all()[:100]:
            last_config = study.config_versions.first()
            studies.append(
                {
                    "study_slug": study.slug,
                    "study_name": study.name,
                    "runtime_mode": study.runtime_mode,
                    "latest_config_version": last_config.version_label if last_config else None,
                    "run_count": study.run_sessions.count(),
                    "last_activity_at": study.updated_at,
                }
            )
        return Response({"studies": studies})


class PublishConfigView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = PublishConfigRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _ = Study.objects.update_or_create(
            slug=data["study_slug"],
            defaults={
                "name": data["study_name"],
                "runtime_mode": data["runtime_mode"],
            },
        )

        config_version, _ = ConfigVersion.objects.update_or_create(
            study=study,
            version_label=data["config_version_label"],
            defaults={
                "builder_version": data.get("builder_version", ""),
                "config_json": data["config"],
            },
        )

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="publish_config",
            resource_type="study",
            resource_id=study.id,
            metadata={"version_label": config_version.version_label},
        )

        return Response(
            {
                "study_id": study.id,
                "config_version_id": config_version.id,
                "study_slug": study.slug,
                "dashboard_url": f"/portal/studies/{study.slug}",
            },
            status=status.HTTP_201_CREATED,
        )


class StartRunView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = StartRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study = Study.objects.filter(slug=data["study_slug"], is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        config_version = study.config_versions.first()
        if not config_version:
            return Response({"error": "No published config version"}, status=status.HTTP_400_BAD_REQUEST)

        participant_external_id = data.get("participant_external_id") or "anonymous"
        participant_key = hash_identifier(participant_external_id)

        run_session = RunSession.objects.create(
            study=study,
            config_version=config_version,
            participant_key=participant_key,
            status="started",
        )

        record_audit(
            action="start_run",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={"study_slug": study.slug},
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": study.slug,
                "config_version_id": config_version.id,
                "config": config_version.config_json,
                "participant_key": participant_key,
            },
            status=status.HTTP_201_CREATED,
        )


class SubmitResultView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = SubmitResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        encrypted_payload = encrypt_payload(json.dumps(data["result_payload"]))
        ResultEnvelope.objects.update_or_create(
            run_session=run_session,
            defaults={
                "trial_count": data["trial_count"],
                "summary_json": data.get("result_summary", {}),
                "encrypted_payload": encrypted_payload,
            },
        )

        run_session.status = data["status"]
        if data["status"] == "completed":
            run_session.completed_at = timezone.now()
        run_session.save(update_fields=["status", "completed_at"])

        record_audit(
            action="submit_result",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={"status": run_session.status, "trial_count": data["trial_count"]},
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "status": run_session.status,
                "stored": True,
            },
            status=status.HTTP_200_OK,
        )
