from django.http import HttpResponse
from django.utils import timezone

from .api_views_common import *
from .study_report_jobs import build_study_analysis_outputs


def _require_study_analysis_access(request, study_slug: str):
    if not request.user.is_authenticated:
        return None, None, None, Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    profile = get_or_create_profile(request.user)
    if not _can_access_analysis_resources(request, profile):
        return None, None, None, Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

    study = Study.objects.filter(slug=study_slug, is_active=True).first()
    if not study:
        return None, None, None, Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _has_study_access(study, request.user, profile):
        return None, None, None, Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

    perms = _study_access_permissions(study, request.user, profile)
    if not perms.get("can_run_analysis"):
        return None, None, None, Response({"error": "Analysis access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)
    if not perms.get("can_download_aggregate"):
        return None, None, None, Response({"error": "Aggregate analysis access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)

    return study, profile, perms, None


def _serialize_report_job(job: StudyAnalysisReportJob):
    artifacts = []
    for artifact in job.artifacts.all().order_by("created_at"):
        text_size = len((artifact.text_content or "").encode("utf-8")) if artifact.text_content else 0
        binary_size = len(artifact.binary_content or b"") if artifact.binary_content else 0
        artifacts.append(
            {
                "format": artifact.artifact_format,
                "file_name": artifact.file_name,
                "mime_type": artifact.mime_type,
                "size_bytes": binary_size or text_size,
                "download_url": f"/api/v1/studies/analysis/jobs/{job.id}/artifacts/{artifact.artifact_format}",
                "created_at": artifact.created_at,
            }
        )
    return {
        "id": job.id,
        "study_slug": job.study.slug,
        "study_name": job.study.name,
        "status": job.status,
        "engine": job.engine,
        "requested_formats": job.requested_formats,
        "include_completed_only": job.include_completed_only,
        "options": job.options,
        "permissions_snapshot": job.permissions_snapshot,
        "overview": (job.snapshot_json or {}).get("overview", {}),
        "error_message": job.error_message,
        "worker_log": job.worker_log,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "artifacts": artifacts,
    }


class StudiesListView(APIView):
    def get(self, request):
        profile = get_or_create_profile(request.user) if request.user.is_authenticated else None
        if request.user.is_authenticated and not _can_access_analysis_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        studies_qs = Study.objects.filter(is_active=True)
        if request.user.is_authenticated:
            # Keep legacy, unowned studies visible while enforcing owner/share RBAC on new studies.
            studies_qs = studies_qs.filter(
                Q(owner_user=request.user)
                | Q(researcher_access__user=request.user)
                | Q(owner_user__isnull=True, researcher_access__isnull=True)
            ).distinct()
        else:
            # Backward-compatible dashboard visibility for legacy studies created pre-auth ownership.
            studies_qs = studies_qs.filter(owner_user__isnull=True, researcher_access__isnull=True).distinct()

        studies_qs = studies_qs.annotate(
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
                    "owner_username": _get_study_owner_username(study),
                    "owner_usernames": _get_study_owner_usernames(study),
                    "latest_config_version": last_config.version_label if last_config else None,
                    "dashboard_url": f"/portal/studies/{study.slug}",
                    "run_count": study.run_count_agg,
                    "last_result_at": study.last_result_at_agg,
                    "last_activity_at": study.last_result_at_agg or study.updated_at,
                    "permissions": _study_access_permissions(study, request.user, profile) if request.user.is_authenticated else {
                        "can_run_analysis": False,
                        "can_download_aggregate": False,
                        "can_view_run_rows": False,
                        "can_view_pseudonyms": False,
                        "can_view_full_payload": False,
                        "can_manage_sharing": False,
                        "can_remove_users": False,
                    },
                }
            )
        return Response({"studies": studies})


class StudyRunsView(APIView):
    """Return recent run metadata for a study to power dashboard result access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_access_analysis_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

        perms = _study_access_permissions(study, request.user, profile)
        if not perms.get("can_view_run_rows"):
            return Response({"error": "Run-level access is not enabled for this study"}, status=status.HTTP_403_FORBIDDEN)

        runs = []
        for run in study.run_sessions.select_related("owner_user", "result_envelope", "config_version").order_by("-started_at")[:20]:
            envelope = getattr(run, "result_envelope", None)
            cfg = getattr(run, "config_version", None)
            cfg_json = cfg.config_json if cfg and isinstance(cfg.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            runs.append(
                {
                    "run_session_id": run.id,
                    "status": run.status,
                    "started_at": run.started_at,
                    "completed_at": run.completed_at,
                    "owner_username": run.owner_user.username if run.owner_user else _get_study_owner_username(study),
                    "participant_key_preview": (
                        f"{run.participant_key[:12]}..."
                        if (run.participant_key and perms.get("can_view_pseudonyms"))
                        else None
                    ),
                    "task_type": task_type,
                    "config_version_id": cfg.id if cfg else None,
                    "config_version_label": cfg.version_label if cfg else None,
                    "has_result": bool(envelope),
                    "trial_count": envelope.trial_count if envelope else 0,
                    "result_created_at": envelope.created_at if envelope else None,
                }
            )

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "runs": runs,
            },
            status=status.HTTP_200_OK,
        )


class StudyAnalysisReportView(APIView):
    """Generate a direct preview using the shared report-rendering pipeline."""

    def post(self, request):
        serializer = StudyAnalysisReportRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _profile, _perms, error = _require_study_analysis_access(request, data["study_slug"])
        if error:
            return error

        outputs = build_study_analysis_outputs(
            study=study,
            engine=data["engine"],
            options=data.get("options") or {},
            include_completed_only=bool(data.get("include_completed_only", True)),
        )
        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "engine": outputs["engine"],
                "options": outputs["options"],
                "overview": outputs["overview"],
                "coverage": outputs["coverage"],
                "numeric_summary": outputs["numeric_summary"],
                "report_markdown": outputs["report_markdown"],
                "r_markdown_document": outputs["r_markdown_document"],
                "can_knit_on_platform": True,
                "can_generate_pdf_on_platform": True,
            },
            status=status.HTTP_200_OK,
        )


class StudyAnalysisReportJobsView(APIView):
    """Queue and inspect asynchronous analysis report jobs."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        study_slug = (request.query_params.get("study_slug") or "").strip()
        jobs_qs = StudyAnalysisReportJob.objects.select_related("study", "requested_by").prefetch_related("artifacts")

        if study_slug:
            study, _profile, _perms, error = _require_study_analysis_access(request, study_slug)
            if error:
                return error
            jobs_qs = jobs_qs.filter(study=study)
        else:
            jobs_qs = jobs_qs.filter(requested_by=request.user)

        return Response({"jobs": [_serialize_report_job(job) for job in jobs_qs[:25]]}, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request):
        serializer = StudyAnalysisReportJobCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _profile, perms, error = _require_study_analysis_access(request, data["study_slug"])
        if error:
            return error

        # Rate limit: max 5 queued/running jobs per user per study in the last hour
        one_hour_ago = timezone.now() - timedelta(hours=1)
        recent_active = StudyAnalysisReportJob.objects.filter(
            study=study,
            requested_by=request.user,
            status__in=[StudyAnalysisReportJob.STATUS_QUEUED, StudyAnalysisReportJob.STATUS_RUNNING],
            created_at__gte=one_hour_ago,
        ).count()
        if recent_active >= 5:
            return Response(
                {"error": "Rate limit exceeded: at most 5 active report jobs per study per hour. Wait for existing jobs to complete."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        requested_formats = list(data.get("requested_formats") or ["markdown", "html", "pdf", "snapshot"])
        if data["engine"] == "r" and "rmd" not in requested_formats:
            requested_formats.append("rmd")

        job = StudyAnalysisReportJob.objects.create(
            study=study,
            requested_by=request.user,
            status=StudyAnalysisReportJob.STATUS_QUEUED,
            engine=data["engine"],
            requested_formats=requested_formats,
            include_completed_only=bool(data.get("include_completed_only", True)),
            options=data.get("options") or {},
            permissions_snapshot=perms,
        )
        record_audit(
            action="analysis_report_job_requested",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "engine": job.engine,
                "requested_formats": job.requested_formats,
            },
        )
        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_202_ACCEPTED)


class StudyAnalysisReportJobDetailView(APIView):
    def get(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study", "requested_by").prefetch_related("artifacts").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_200_OK)


class StudyAnalysisReportArtifactDownloadView(APIView):
    def get(self, request, job_id: int, artifact_format: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        artifact_format = str(artifact_format or "").strip().lower()
        artifact = (
            StudyAnalysisReportArtifact.objects.select_related("job", "job__study")
            .filter(job_id=job_id, artifact_format=artifact_format)
            .first()
        )
        if not artifact:
            return Response({"error": "Artifact not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, artifact.job.study.slug)
        if error:
            return error

        record_audit(
            action="analysis_report_artifact_downloaded",
            resource_type="study_report_job",
            resource_id=artifact.job.id,
            actor=request.user.username,
            metadata={
                "study_slug": artifact.job.study.slug,
                "artifact_format": artifact.artifact_format,
                "file_name": artifact.file_name,
            },
        )

        content = artifact.binary_content if artifact.binary_content else (artifact.text_content or "")
        response = HttpResponse(content, content_type=artifact.mime_type)
        response["Content-Disposition"] = f'attachment; filename="{artifact.file_name}"'
        return response


class StudyAnalysisReportJobCancelView(APIView):
    """Cancel a queued report job (only queued jobs may be cancelled)."""

    def post(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        if job.requested_by_id and job.requested_by_id != request.user.id:
            return Response({"error": "You can only cancel your own jobs"}, status=status.HTTP_403_FORBIDDEN)

        if job.status not in (StudyAnalysisReportJob.STATUS_QUEUED,):
            return Response(
                {"error": f"Job cannot be cancelled in status '{job.status}'. Only queued jobs may be cancelled."},
                status=status.HTTP_409_CONFLICT,
            )

        job.status = StudyAnalysisReportJob.STATUS_FAILED
        job.error_message = "Cancelled by user"
        job.completed_at = timezone.now()
        job.save(update_fields=["status", "error_message", "completed_at", "updated_at"])

        record_audit(
            action="analysis_report_job_cancelled",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={"study_slug": job.study.slug},
        )
        return Response({"ok": True, "job": _serialize_report_job(job)}, status=status.HTTP_200_OK)


class StudyAnalysisReportJobDeleteView(APIView):
    """Delete a completed or failed report job and all its artifacts."""

    def delete(self, request, job_id: int):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        job = StudyAnalysisReportJob.objects.select_related("study").filter(id=job_id).first()
        if not job:
            return Response({"error": "Report job not found"}, status=status.HTTP_404_NOT_FOUND)

        _study, _profile, _perms, error = _require_study_analysis_access(request, job.study.slug)
        if error:
            return error

        if job.requested_by_id and job.requested_by_id != request.user.id:
            return Response({"error": "You can only delete your own jobs"}, status=status.HTTP_403_FORBIDDEN)

        if job.status in (StudyAnalysisReportJob.STATUS_QUEUED, StudyAnalysisReportJob.STATUS_RUNNING):
            return Response(
                {"error": "Cannot delete an active job. Cancel it first."},
                status=status.HTTP_409_CONFLICT,
            )

        record_audit(
            action="analysis_report_job_deleted",
            resource_type="study_report_job",
            resource_id=job.id,
            actor=request.user.username,
            metadata={"study_slug": job.study.slug, "status": job.status},
        )
        job.delete()
        return Response({"ok": True}, status=status.HTTP_200_OK)


class StudyLatestConfigView(APIView):
    """Return the latest published config JSON for a study the researcher can access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        versions = list(study.config_versions.all())
        config_version = versions[0] if versions else None
        if not config_version:
            return Response({"error": "No published config version"}, status=status.HTTP_404_NOT_FOUND)

        configs = []
        available_task_types = []
        for v in versions:
            cfg_json = v.config_json if isinstance(v.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            if task_type and task_type not in available_task_types:
                available_task_types.append(task_type)
            configs.append(
                {
                    "config_version_id": v.id,
                    "config_version_label": v.version_label,
                    "task_type": task_type,
                    "config": v.config_json,
                }
            )

        latest_task_type = (config_version.config_json.get("task_type") or config_version.config_json.get("taskType") or "") if isinstance(config_version.config_json, dict) else ""
        latest_task_type = str(latest_task_type).strip().lower() or None

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "task_type": latest_task_type,
                "available_task_types": available_task_types,
                "configs": configs,
                "config": config_version.config_json,
            },
            status=status.HTTP_200_OK,
        )


class PublishConfigView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = PublishConfigRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)
        profile = None
        if request.user.is_authenticated:
            profile = get_or_create_profile(request.user)

        existing_study = Study.objects.filter(slug=data["study_slug"]).first()
        if existing_study and request.user.is_authenticated and _can_manage_researcher_resources(request, profile):
            if existing_study.owner_user_id and not _has_study_access(existing_study, request.user, profile):
                return Response(
                    {"error": "Study is not shared with the current researcher"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if existing_study:
            study = existing_study
            study.name = data["study_name"]
            study.runtime_mode = data["runtime_mode"]
            study.save(update_fields=["name", "runtime_mode"])
        else:
            study = Study.objects.create(
                slug=data["study_slug"],
                name=data["study_name"],
                runtime_mode=data["runtime_mode"],
            )

        if request.user.is_authenticated:
            if _can_manage_researcher_resources(request, profile):
                if study.owner_user_id and not _has_study_access(study, request.user, profile):
                    return Response(
                        {"error": "Study is not shared with the current researcher"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if not study.owner_user_id or study.owner_user_id == request.user.id:
                    study.owner_user = request.user
                    study.save(update_fields=["owner_user"])
                elif study.owner_user_id != request.user.id:
                    StudyResearcherAccess.objects.get_or_create(
                        study=study,
                        user=request.user,
                        defaults={"granted_by": request.user},
                    )

        requested_version_label = data["config_version_label"]
        incoming_task_type = _extract_config_task_type(data.get("config"))
        label_adjusted = False

        existing_same_label = ConfigVersion.objects.filter(
            study=study,
            version_label=requested_version_label,
        ).first()

        if not existing_same_label:
            config_version = ConfigVersion.objects.create(
                study=study,
                version_label=requested_version_label,
                builder_version=data.get("builder_version", ""),
                config_json=data["config"],
            )
        else:
            existing_task_type = _extract_config_task_type(existing_same_label.config_json)
            same_task_type = bool(incoming_task_type) and bool(existing_task_type) and (incoming_task_type == existing_task_type)
            same_content = (existing_same_label.config_json == data["config"])

            if same_task_type or same_content:
                existing_same_label.builder_version = data.get("builder_version", "")
                existing_same_label.config_json = data["config"]
                existing_same_label.save(update_fields=["builder_version", "config_json"])
                config_version = existing_same_label
            else:
                suffix = incoming_task_type or "task"
                safe_suffix = re.sub(r"[^a-z0-9_-]", "-", suffix.lower()).strip("-") or "task"
                candidate = f"{requested_version_label}__{safe_suffix}"
                n = 2
                while ConfigVersion.objects.filter(study=study, version_label=candidate).exists():
                    candidate = f"{requested_version_label}__{safe_suffix}-{n}"
                    n += 1

                config_version = ConfigVersion.objects.create(
                    study=study,
                    version_label=candidate,
                    builder_version=data.get("builder_version", ""),
                    config_json=data["config"],
                )
                label_adjusted = True

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="publish_config",
            resource_type="study",
            resource_id=study.id,
            actor=actor,
            metadata={
                "requested_version_label": requested_version_label,
                "version_label": config_version.version_label,
                "version_label_adjusted": label_adjusted,
                "task_type": incoming_task_type,
            },
        )

        return Response(
            {
                "study_id": study.id,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "requested_config_version_label": requested_version_label,
                "config_version_label_adjusted": label_adjusted,
                "study_slug": study.slug,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "dashboard_url": f"/portal/studies/{study.slug}",
            },
            status=status.HTTP_201_CREATED,
        )


class UploadBuilderAssetView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Missing file"}, status=status.HTTP_400_BAD_REQUEST)

        max_bytes = int(os.getenv("BUILDER_ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
        if (getattr(uploaded, "size", 0) or 0) > max_bytes:
            return Response({"error": f"File too large (max {max_bytes} bytes)"}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        original_name = (uploaded.name or "asset").strip() or "asset"
        ext = os.path.splitext(original_name.lower())[1]
        allowed_exts = {
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif",
            ".mp3", ".wav", ".ogg", ".m4a",
            ".mp4", ".webm",
        }
        if ext not in allowed_exts:
            return Response({"error": f"Unsupported asset type: {ext or 'unknown'}"}, status=status.HTTP_400_BAD_REQUEST)

        content_type = (uploaded.content_type or "").strip().lower()
        if content_type and not (
            content_type.startswith("image/")
            or content_type.startswith("audio/")
            or content_type.startswith("video/")
        ):
            return Response({"error": f"Unsupported content type: {content_type}"}, status=status.HTTP_400_BAD_REQUEST)

        study_slug = (request.data.get("study_slug") or "").strip()
        study = None
        scope_slug = "unscoped"

        if study_slug:
            study = Study.objects.filter(slug=study_slug).first()
            if not study:
                return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)
            if not _has_study_access(study, request.user, profile):
                return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)
            scope_slug = study.slug

        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        safe_name = re.sub(r"_+", "_", safe_name).strip("._")
        if not safe_name:
            safe_name = "asset"

        rel_path = default_storage.save(
            f"builder-assets/u{request.user.id}/{scope_slug}/{uuid4().hex[:12]}-{safe_name}",
            uploaded,
        )
        rel_path = rel_path.replace("\\", "/")

        try:
            public_url = request.build_absolute_uri(f"/api/v1/assets/file/{quote(rel_path, safe='/')}")
        except Exception:
            public_url = request.build_absolute_uri(f"/api/v1/assets/file/{quote(rel_path, safe='/')}")

        return Response(
            {
                "ok": True,
                "url": public_url,
                "path": rel_path,
                "study_slug": study.slug if study else None,
                "filename": original_name,
                "uploader_user_id": request.user.id,
            },
            status=status.HTTP_201_CREATED,
        )


class DownloadBuilderAssetView(APIView):
    def get(self, request, asset_path: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        normalized = (asset_path or "").replace("\\", "/").strip("/")
        if not normalized.startswith("builder-assets/"):
            return Response({"error": "Invalid builder asset path"}, status=status.HTTP_400_BAD_REQUEST)

        m = re.match(r"^builder-assets/u(?P<uid>\d+)/(?P<scope>[^/]+)/.+$", normalized)
        if not m:
            return Response({"error": "Forbidden asset scope"}, status=status.HTTP_403_FORBIDDEN)

        owner_user_id = int(m.group("uid"))
        if owner_user_id != request.user.id:
            return Response({"error": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        if not default_storage.exists(normalized):
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)

        fh = default_storage.open(normalized, mode="rb")
        guessed_type, _ = mimetypes.guess_type(normalized)
        response = FileResponse(fh, content_type=guessed_type or "application/octet-stream")
        response["Cache-Control"] = "private, max-age=0, no-cache"
        return response


class CreateParticipantLinkView(APIView):
    """Generate signed participant launch links for a researcher-owned study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        owner_username = _get_study_owner_username(study)
        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CreateParticipantLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        config_versions = list(study.config_versions.all())
        known_ids = {str(cv.id) for cv in config_versions}

        expires_at = timezone.now() + timedelta(hours=data.get("expires_in_hours", 72))
        participant_external_id = (data.get("participant_external_id") or "").strip()
        counterbalance_enabled = bool(data.get("counterbalance_enabled", True))
        task_order_strict = bool(data.get("task_order_strict", False))
        raw_task_order = data.get("task_order") or []
        task_order = []
        for raw in raw_task_order:
            sid = str(raw or "").strip()
            if not sid or sid not in known_ids or sid in task_order:
                continue
            task_order.append(sid)
        completion_redirect_url = (data.get("completion_redirect_url") or "").strip()
        abort_redirect_url = (data.get("abort_redirect_url") or "").strip()
        prolific_completion_mode = (data.get("prolific_completion_mode") or "default").strip() or "default"
        prolific_completion_code = (data.get("prolific_completion_code") or "").strip()
        base_payload = {
            "study_slug": study.slug,
            "researcher_username": request.user.username,
            "participant_external_id": participant_external_id,
            "counterbalance_enabled": counterbalance_enabled,
            "task_order": task_order,
            "task_order_strict": task_order_strict,
            "expires_at": expires_at.isoformat(),
            "completion_redirect_url": completion_redirect_url,
            "abort_redirect_url": abort_redirect_url,
            "prolific_completion_mode": prolific_completion_mode,
            "prolific_completion_code": prolific_completion_code,
        }
        single_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "single_use",
            }
        )
        multi_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "multi_use",
            }
        )

        record_audit(
            action="create_participant_link",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "expires_at": expires_at.isoformat(),
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
                "prolific_completion_mode": prolific_completion_mode,
                "has_prolific_completion_code": bool(prolific_completion_code),
                "counterbalance_enabled": counterbalance_enabled,
                "task_order_count": len(task_order),
                "task_order_strict": task_order_strict,
                "single_use_token_digest": _launch_token_digest(single_use_token),
                "multi_use_token_digest": _launch_token_digest(multi_use_token),
            },
        )

        launch_url_multi = f"/interpreter/index.html?launch={multi_use_token}"
        launch_url_single = f"/interpreter/index.html?launch={single_use_token}"
        return Response(
            {
                "study_slug": study.slug,
                "launch_token": multi_use_token,
                "launch_url": launch_url_multi,
                "counterbalance_enabled": counterbalance_enabled,
                "task_order": task_order,
                "task_order_strict": task_order_strict,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "prolific_completion_mode": prolific_completion_mode,
                "prolific_completion_code": prolific_completion_code,
                "launch_options": {
                    "multi_use": {
                        "launch_mode": "multi_use",
                        "launch_token": multi_use_token,
                        "launch_url": launch_url_multi,
                        "counterbalance_enabled": counterbalance_enabled,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                    "single_use": {
                        "launch_mode": "single_use",
                        "launch_token": single_use_token,
                        "launch_url": launch_url_single,
                        "counterbalance_enabled": counterbalance_enabled,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                },
                "expires_at": expires_at,
                "owner_username": owner_username or request.user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_201_CREATED,
        )


class AssignStudyOwnerView(APIView):
    """Allow platform admins to reassign researcher ownership for a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if profile.role != profile.ROLE_ADMIN:
            return Response({"error": "Platform admin role required"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = AssignStudyOwnerRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["owner_username"].strip()

        new_owner = User.objects.filter(username=target_username).first()
        if not new_owner:
            return Response({"error": "Owner user not found"}, status=status.HTTP_404_NOT_FOUND)

        study.owner_user = new_owner
        study.save(update_fields=["owner_user"])

        record_audit(
            action="assign_study_owner",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "new_owner_username": new_owner.username,
            },
        )

        return Response(
            {
                "study_slug": study.slug,
                "owner_username": new_owner.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class ShareStudyView(APIView):
    """Share a study with another user by username and granular study permissions."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)
        if study.owner_user_id != request.user.id:
            return Response({"error": "Only the study owner can manage sharing"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ShareStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()
        requested_permissions = {
            "can_remove_users": bool(serializer.validated_data.get("can_remove_users", False)),
            "can_run_analysis": bool(serializer.validated_data.get("can_run_analysis", True)),
            "can_download_aggregate": bool(serializer.validated_data.get("can_download_aggregate", True)),
            "can_view_run_rows": bool(serializer.validated_data.get("can_view_run_rows", False)),
            "can_view_pseudonyms": bool(serializer.validated_data.get("can_view_pseudonyms", False)),
            "can_view_full_payload": bool(serializer.validated_data.get("can_view_full_payload", False)),
            "can_manage_sharing": bool(serializer.validated_data.get("can_manage_sharing", False)),
        }

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        if not target_user.is_active:
            return Response({"error": "User account is inactive"}, status=status.HTTP_400_BAD_REQUEST)

        target_profile = get_or_create_profile(target_user)
        if target_profile.role not in {
            target_profile.ROLE_RESEARCHER,
            target_profile.ROLE_ADMIN,
            target_profile.ROLE_ANALYST,
        }:
            return Response(
                {"error": "Only researcher/admin/analyst accounts can receive study shares"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        already_owner = study.owner_user_id == target_user.id
        created = False
        permission_updated = False
        if not already_owner:
            access, created = StudyResearcherAccess.objects.get_or_create(
                study=study,
                user=target_user,
                defaults={
                    "granted_by": request.user,
                    **requested_permissions,
                },
            )
            if not created:
                updated_fields = []
                for key, value in requested_permissions.items():
                    if getattr(access, key) != value:
                        setattr(access, key, value)
                        updated_fields.append(key)
                if updated_fields:
                    access.save(update_fields=updated_fields)
                    permission_updated = True
        effective_permissions = requested_permissions if not already_owner else _study_access_permissions(study, target_user, target_profile)

        record_audit(
            action="share_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_owner": already_owner,
                "created": created,
                "permissions": effective_permissions,
                "permission_updated": permission_updated,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_shared": already_owner or (not created),
                "permissions": effective_permissions,
                "permission_updated": permission_updated,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class ShareStudyValidateUserView(APIView):
    """Validate a target username for sharing without exposing user listings."""

    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)
        if study.owner_user_id != request.user.id:
            return Response({"error": "Only the study owner can manage sharing"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ShareStudyValidateUserRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"exists": False, "eligible": False}, status=status.HTTP_200_OK)
        if not target_user.is_active:
            return Response({"exists": True, "eligible": False, "reason": "inactive"}, status=status.HTTP_200_OK)

        target_profile = get_or_create_profile(target_user)
        eligible = target_profile.role in {
            target_profile.ROLE_RESEARCHER,
            target_profile.ROLE_ANALYST,
            target_profile.ROLE_ADMIN,
        }
        return Response(
            {
                "exists": True,
                "eligible": eligible,
                "role": target_profile.role if eligible else None,
                "is_owner": bool(study.owner_user_id == target_user.id),
            },
            status=status.HTTP_200_OK,
        )


class RevokeStudyAccessView(APIView):
    """Remove researcher collaboration access from a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not shared with the current user"}, status=status.HTTP_403_FORBIDDEN)

        if not _can_remove_study_users(study, request.user, profile):
            return Response({"error": "You do not have permission to remove users for this study"}, status=status.HTTP_403_FORBIDDEN)

        serializer = RevokeStudyAccessRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if study.owner_user_id == target_user.id:
            return Response({"error": "Cannot remove the study owner"}, status=status.HTTP_400_BAD_REQUEST)

        access = StudyResearcherAccess.objects.filter(study=study, user=target_user).first()
        if not access:
            return Response({"error": "User does not currently have collaborator access"}, status=status.HTTP_400_BAD_REQUEST)

        access.delete()

        record_audit(
            action="revoke_study_access",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "revoked_username": target_user.username,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "revoked_username": target_user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class DuplicateStudyView(APIView):
    """Duplicate a study and clone its latest published config for further editing."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        source_study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not source_study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(source_study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = DuplicateStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        requested_name = (serializer.validated_data.get("study_name") or "").strip()
        requested_slug = (serializer.validated_data.get("study_slug") or "").strip()

        new_study_name = requested_name or f"{source_study.name} (Copy)"
        base_slug = slugify(requested_slug or new_study_name) or slugify(f"{source_study.slug}-copy") or "study-copy"
        if base_slug == source_study.slug:
            base_slug = f"{base_slug}-copy"

        candidate_slug = base_slug
        n = 2
        while Study.objects.filter(slug=candidate_slug).exists():
            candidate_slug = f"{base_slug}-{n}"
            n += 1

        source_config = source_study.config_versions.first()
        if not source_config:
            return Response({"error": "No published config version found to duplicate"}, status=status.HTTP_400_BAD_REQUEST)

        duplicated_study = Study.objects.create(
            slug=candidate_slug,
            name=new_study_name,
            runtime_mode=source_study.runtime_mode,
            owner_user=request.user,
            is_active=True,
        )

        duplicated_config = ConfigVersion.objects.create(
            study=duplicated_study,
            version_label=source_config.version_label,
            builder_version=source_config.builder_version,
            config_json=source_config.config_json,
        )

        record_audit(
            action="duplicate_study",
            resource_type="study",
            resource_id=duplicated_study.id,
            actor=request.user.username,
            metadata={
                "source_study_slug": source_study.slug,
                "duplicated_study_slug": duplicated_study.slug,
                "source_config_version_id": source_config.id,
                "duplicated_config_version_id": duplicated_config.id,
            },
        )

        return Response(
            {
                "ok": True,
                "source_study_slug": source_study.slug,
                "study_slug": duplicated_study.slug,
                "study_name": duplicated_study.name,
                "runtime_mode": duplicated_study.runtime_mode,
                "owner_username": _get_study_owner_username(duplicated_study),
                "owner_usernames": _get_study_owner_usernames(duplicated_study),
                "config_version_id": duplicated_config.id,
                "config_version_label": duplicated_config.version_label,
            },
            status=status.HTTP_201_CREATED,
        )


class DeleteStudyView(APIView):
    """Soft-delete (deactivate) a study while retaining all audit/config/result records."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        config_count = study.config_versions.count()
        run_count = study.run_sessions.count()
        result_count = ResultEnvelope.objects.filter(run_session__study=study).count()

        study.is_active = False
        study.updated_at = timezone.now()
        study.save(update_fields=["is_active", "updated_at"])

        record_audit(
            action="delete_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "study_name": study.name,
                "config_versions_retained": config_count,
                "run_sessions_retained": run_count,
                "result_envelopes_retained": result_count,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "study_name": study.name,
                "is_active": study.is_active,
                "retained": {
                    "config_versions": config_count,
                    "run_sessions": run_count,
                    "result_envelopes": result_count,
                },
            },
            status=status.HTTP_200_OK,
        )


