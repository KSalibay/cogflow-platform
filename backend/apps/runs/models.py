import uuid

from django.db import models

from project.constants import RUN_STATUS_CHOICES, RUN_STATUS_STARTED


class RunSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    study = models.ForeignKey("studies.Study", on_delete=models.CASCADE, related_name="run_sessions")
    config_version = models.ForeignKey("configs.ConfigVersion", on_delete=models.PROTECT, related_name="run_sessions")
    owner_user = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_run_sessions",
    )
    participant_key = models.CharField(max_length=128)
    status = models.CharField(max_length=20, choices=RUN_STATUS_CHOICES, default=RUN_STATUS_STARTED)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
