from django.db import models


class AuditEvent(models.Model):
    actor = models.CharField(max_length=128, default="system")
    action = models.CharField(max_length=64)
    resource_type = models.CharField(max_length=64)
    resource_id = models.CharField(max_length=128)
    metadata_json = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
