import uuid

from django.db import models


class RunSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    study = models.ForeignKey("studies.Study", on_delete=models.CASCADE, related_name="run_sessions")
    config_version = models.ForeignKey("configs.ConfigVersion", on_delete=models.PROTECT, related_name="run_sessions")
    participant_key = models.CharField(max_length=128)
    status = models.CharField(max_length=20, default="started")
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
