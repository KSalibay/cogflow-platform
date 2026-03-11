from django.db import models


class ConfigVersion(models.Model):
    study = models.ForeignKey("studies.Study", on_delete=models.CASCADE, related_name="config_versions")
    version_label = models.CharField(max_length=50)
    builder_version = models.CharField(max_length=50, blank=True)
    config_json = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["study", "version_label"], name="uq_study_version_label"),
        ]
        ordering = ["-created_at"]
