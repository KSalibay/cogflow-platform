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


class TaskCreditAssignment(models.Model):
    component_type = models.CharField(max_length=80, unique=True)
    scope_text = models.TextField(blank=True, default="")
    credit_roles = models.JSONField(default=list, blank=True)
    contributors = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")
    updated_by = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_task_credit_assignments",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["component_type"]


class TaskCreditRow(models.Model):
    task_type = models.CharField(max_length=80)
    component_type = models.CharField(max_length=80)
    credit_role = models.CharField(max_length=80)
    contributor_username = models.CharField(max_length=150)
    notes = models.TextField(blank=True, default="")
    updated_by = models.ForeignKey(
        "auth.User",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="updated_task_credit_rows",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["task_type", "component_type", "credit_role", "contributor_username", "id"]
