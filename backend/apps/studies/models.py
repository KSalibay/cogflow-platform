from django.db import models

from project.constants import RUNTIME_MODE_CHOICES, RUNTIME_MODE_DJANGO


class Study(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=255)
    owner_user = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_studies",
    )
    runtime_mode = models.CharField(max_length=20, choices=RUNTIME_MODE_CHOICES, default=RUNTIME_MODE_DJANGO)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.slug


class StudyResearcherAccess(models.Model):
    """Researcher-level collaboration access for shared studies."""

    study = models.ForeignKey(Study, on_delete=models.CASCADE, related_name="researcher_access")
    user = models.ForeignKey("auth.User", on_delete=models.CASCADE, related_name="study_access")
    granted_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="granted_study_access",
    )
    can_remove_users = models.BooleanField(default=False)
    can_run_analysis = models.BooleanField(default=True)
    can_download_aggregate = models.BooleanField(default=True)
    can_view_run_rows = models.BooleanField(default=False)
    can_view_pseudonyms = models.BooleanField(default=False)
    can_view_full_payload = models.BooleanField(default=False)
    can_manage_sharing = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["study", "user"], name="uniq_study_researcher_access"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.study.slug}:{self.user.username}"


class StudyAnalysisReportJob(models.Model):
    STATUS_QUEUED = "queued"
    STATUS_RUNNING = "running"
    STATUS_SUCCEEDED = "succeeded"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_QUEUED, "Queued"),
        (STATUS_RUNNING, "Running"),
        (STATUS_SUCCEEDED, "Succeeded"),
        (STATUS_FAILED, "Failed"),
    ]

    study = models.ForeignKey(Study, on_delete=models.CASCADE, related_name="analysis_report_jobs")
    requested_by = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="requested_analysis_report_jobs",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_QUEUED)
    engine = models.CharField(max_length=20, default="python")
    requested_formats = models.JSONField(default=list, blank=True)
    include_completed_only = models.BooleanField(default=True)
    options = models.JSONField(default=dict, blank=True)
    permissions_snapshot = models.JSONField(default=dict, blank=True)
    snapshot_json = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    worker_log = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"report-job:{self.study.slug}:{self.id}:{self.status}"


class StudyAnalysisReportArtifact(models.Model):
    FORMAT_MARKDOWN = "markdown"
    FORMAT_RMD = "rmd"
    FORMAT_HTML = "html"
    FORMAT_PDF = "pdf"
    FORMAT_SNAPSHOT = "snapshot"
    FORMAT_CHOICES = [
        (FORMAT_MARKDOWN, "Markdown"),
        (FORMAT_RMD, "R Markdown"),
        (FORMAT_HTML, "HTML"),
        (FORMAT_PDF, "PDF"),
        (FORMAT_SNAPSHOT, "Snapshot"),
    ]

    job = models.ForeignKey(StudyAnalysisReportJob, on_delete=models.CASCADE, related_name="artifacts")
    artifact_format = models.CharField(max_length=20, choices=FORMAT_CHOICES)
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=120)
    text_content = models.TextField(blank=True)
    binary_content = models.BinaryField(null=True, blank=True)
    metadata_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["job", "artifact_format"], name="uniq_report_job_artifact_format"),
        ]

    def __str__(self) -> str:
        return f"report-artifact:{self.job_id}:{self.artifact_format}"
