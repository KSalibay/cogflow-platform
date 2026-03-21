from django.db import models


class ResultEnvelope(models.Model):
    """One summary envelope per run session — stores the aggregate result payload."""

    run_session = models.OneToOneField("runs.RunSession", on_delete=models.CASCADE, related_name="result_envelope")
    trial_count = models.IntegerField(default=0)
    summary_json = models.JSONField(default=dict)
    encrypted_payload = models.TextField()
    key_version = models.CharField(max_length=50, default="v1")
    encryption_alg = models.CharField(max_length=50, default="fernet-256")
    created_at = models.DateTimeField(auto_now_add=True)


class TrialResult(models.Model):
    """One row per trial — cleartext aggregate fields for queries, full data encrypted."""

    run_session = models.ForeignKey("runs.RunSession", on_delete=models.CASCADE, related_name="trial_results")
    trial_index = models.PositiveIntegerField()
    block_label = models.CharField(max_length=100, blank=True, default="")
    task_name = models.CharField(max_length=100, blank=True, default="")
    # Cleartext fields — study design metadata only, safe for aggregate queries.
    # block_label and task_name identify the condition/block structure, not the
    # participant's response.  All behavioural fields (rt, response, accuracy)
    # are intentionally blank here and stored only in encrypted_payload.
    stimulus_key = models.CharField(max_length=200, blank=True, default="")
    response_key = models.CharField(max_length=200, blank=True, default="")
    rt_ms = models.PositiveIntegerField(null=True, blank=True)
    correct = models.BooleanField(null=True, blank=True)
    # Full trial dict encrypted
    encrypted_payload = models.TextField()
    key_version = models.CharField(max_length=50, default="v1")
    encryption_alg = models.CharField(max_length=50, default="fernet-256")
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["trial_index"]
        unique_together = [("run_session", "trial_index")]
