import os
from datetime import timedelta

import pyotp
from django.contrib.auth import authenticate, login, logout
from django.db import transaction
from django.db.models import Count, Max
from django.shortcuts import render
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion
from apps.runs.models import RunSession
from apps.studies.models import Study
from apps.users.services import get_or_create_profile
from apps.results.services import (
    get_decrypted_envelope,
    get_decrypted_trial,
    store_result_envelope,
    store_trial_results,
)
from project.api_serializers import (
    AuthLoginRequestSerializer,
    DecryptResultRequestSerializer,
    PublishConfigRequestSerializer,
    StartRunRequestSerializer,
    SubmitResultRequestSerializer,
    TotpSetupRequestSerializer,
    TotpVerifyRequestSerializer,
)
from project.constants import RUN_STATUS_COMPLETED
from project.security import decrypt_payload, encrypt_payload, hash_identifier


def record_audit(
    action: str,
    resource_type: str,
    resource_id: str,
    metadata: dict | None = None,
    actor: str = "system",
) -> None:
    AuditEvent.objects.create(
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        metadata_json=metadata or {},
    )


class HealthView(APIView):
    def get(self, request):
        return Response({"ok": True})


def _get_actor_from_request(request) -> str:
    if getattr(request, "user", None) and request.user.is_authenticated:
        return request.user.username
    return (request.headers.get("X-CogFlow-Actor") or "unknown").strip() or "unknown"


def _mark_mfa_verified(request) -> str:
    now_iso = timezone.now().isoformat()
    request.session["mfa_verified_at"] = now_iso
    request.session.modified = True
    return now_iso


def _is_mfa_session_fresh(request) -> bool:
    stamp = request.session.get("mfa_verified_at")
    if not stamp:
        return False
    try:
        ts = timezone.datetime.fromisoformat(stamp)
    except Exception:
        return False
    if timezone.is_naive(ts):
        ts = timezone.make_aware(ts)
    max_age_seconds = int(os.getenv("MFA_REAUTH_SECONDS", "900"))
    return timezone.now() - ts <= timedelta(seconds=max_age_seconds)


class AuthLoginView(APIView):
    """Session login endpoint for portal user flows."""

    @transaction.atomic
    def post(self, request):
        serializer = AuthLoginRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = authenticate(request, username=data["username"], password=data["password"])
        if not user:
            return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

        login(request, user)
        # Require fresh MFA verification for sensitive actions after each login.
        request.session.pop("mfa_verified_at", None)
        profile = get_or_create_profile(user)

        record_audit(
            action="auth_login",
            resource_type="user",
            resource_id=user.id,
            actor=user.username,
            metadata={"mfa_enabled": profile.mfa_enabled},
        )

        return Response(
            {
                "ok": True,
                "username": user.username,
                "mfa_enabled": profile.mfa_enabled,
            },
            status=status.HTTP_200_OK,
        )


class AuthLogoutView(APIView):
    @transaction.atomic
    def post(self, request):
        if request.user.is_authenticated:
            record_audit(
                action="auth_logout",
                resource_type="user",
                resource_id=request.user.id,
                actor=request.user.username,
            )
        logout(request)
        return Response({"ok": True}, status=status.HTTP_200_OK)


class TotpSetupView(APIView):
    """Generate or return TOTP setup material for the logged-in user."""

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TotpSetupRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        profile = get_or_create_profile(request.user)
        regenerate = data.get("regenerate", False)

        secret = None
        if profile.mfa_totp_secret_encrypted and not regenerate:
            secret = decrypt_payload(profile.mfa_totp_secret_encrypted)
        else:
            secret = pyotp.random_base32()
            profile.mfa_totp_secret_encrypted = encrypt_payload(secret)
            profile.mfa_enabled = False
            profile.mfa_last_verified_at = None
            profile.save(update_fields=["mfa_totp_secret_encrypted", "mfa_enabled", "mfa_last_verified_at"])
            request.session.pop("mfa_verified_at", None)
            request.session.modified = True

        issuer = os.getenv("MFA_TOTP_ISSUER", "CogFlow Platform")
        otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=request.user.username, issuer_name=issuer)

        record_audit(
            action="mfa_totp_setup",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
            metadata={"regenerate": regenerate},
        )

        return Response(
            {
                "ok": True,
                "username": request.user.username,
                "totp_secret": secret,
                "otpauth_uri": otpauth_uri,
            },
            status=status.HTTP_200_OK,
        )


class TotpVerifyView(APIView):
    """Verify a TOTP code and mark MFA as active for this session."""

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TotpVerifyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data["code"].strip()

        profile = get_or_create_profile(request.user)
        if not profile.mfa_totp_secret_encrypted:
            return Response({"error": "TOTP not set up"}, status=status.HTTP_400_BAD_REQUEST)

        secret = decrypt_payload(profile.mfa_totp_secret_encrypted)
        totp = pyotp.TOTP(secret)
        if not totp.verify(code, valid_window=1):
            record_audit(
                action="mfa_totp_verify_failed",
                resource_type="user",
                resource_id=request.user.id,
                actor=request.user.username,
            )
            return Response({"error": "Invalid TOTP code"}, status=status.HTTP_401_UNAUTHORIZED)

        profile.mfa_enabled = True
        profile.mfa_last_verified_at = timezone.now()
        profile.save(update_fields=["mfa_enabled", "mfa_last_verified_at"])
        stamp = _mark_mfa_verified(request)

        record_audit(
            action="mfa_totp_verify",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
        )

        return Response(
            {
                "ok": True,
                "username": request.user.username,
                "mfa_enabled": profile.mfa_enabled,
                "mfa_verified_at": stamp,
            },
            status=status.HTTP_200_OK,
        )


class PortalDashboardView(APIView):
    """Serve the portal dashboard draft as a Django template."""

    schema = None

    def get(self, request):
        return render(request, "portal/index.html")


class StudiesListView(APIView):
    def get(self, request):
        studies_qs = Study.objects.annotate(
            run_count_agg=Count("run_sessions", distinct=True),
            last_result_at_agg=Max("run_sessions__result_envelope__created_at"),
        )
        studies = []
        for study in studies_qs[:100]:
            last_config = study.config_versions.first()
            studies.append(
                {
                    "study_slug": study.slug,
                    "study_name": study.name,
                    "runtime_mode": study.runtime_mode,
                    "latest_config_version": last_config.version_label if last_config else None,
                    "dashboard_url": f"/portal/studies/{study.slug}",
                    "run_count": study.run_count_agg,
                    "last_result_at": study.last_result_at_agg,
                    "last_activity_at": study.last_result_at_agg or study.updated_at,
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

        envelope = store_result_envelope(
            run_session=run_session,
            trial_count=data["trial_count"],
            summary_json=data.get("result_summary", {}),
            result_payload=data["result_payload"],
        )

        trial_records_stored = store_trial_results(
            run_session=run_session,
            trials=data.get("trials", []),
        )

        run_session.status = data["status"]
        if data["status"] == RUN_STATUS_COMPLETED:
            run_session.completed_at = timezone.now()
        run_session.save(update_fields=["status", "completed_at"])

        record_audit(
            action="submit_result",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "status": run_session.status,
                "trial_count": data["trial_count"],
                "trial_records_stored": trial_records_stored,
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "result_envelope_id": envelope.id,
                "status": run_session.status,
                "stored": True,
                "trial_records_stored": trial_records_stored,
            },
            status=status.HTTP_201_CREATED,
        )


class DecryptResultView(APIView):
    """Protected decrypt/read endpoint for interim Day 6 privacy controls."""

    @transaction.atomic
    def post(self, request):
        serializer = DecryptResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)

        if not request.user.is_authenticated:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "unauthenticated",
                    "include_trials": data.get("include_trials", False),
                },
            )
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        mfa_enabled = bool(profile.mfa_enabled)
        if not mfa_enabled or not _is_mfa_session_fresh(request):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "mfa_required",
                    "mfa_enabled": mfa_enabled,
                },
            )
            return Response({"error": "MFA verification required"}, status=status.HTTP_403_FORBIDDEN)

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={"reason": "run_session_not_found"},
            )
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        envelope = getattr(run_session, "result_envelope", None)
        if not envelope:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "result_envelope_not_found"},
            )
            return Response({"error": "Result envelope not found"}, status=status.HTTP_404_NOT_FOUND)

        result_payload = get_decrypted_envelope(envelope)
        include_trials = data.get("include_trials", False)
        trials = []
        if include_trials:
            for trial in run_session.trial_results.all().order_by("trial_index"):
                trials.append(get_decrypted_trial(trial))

        record_audit(
            action="decrypt_result",
            resource_type="run_session",
            resource_id=run_session.id,
            actor=actor,
            metadata={
                "include_trials": include_trials,
                "trial_records_returned": len(trials),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": run_session.study.slug,
                "status": run_session.status,
                "result_payload": result_payload,
                "trials": trials if include_trials else None,
            },
            status=status.HTTP_200_OK,
        )
