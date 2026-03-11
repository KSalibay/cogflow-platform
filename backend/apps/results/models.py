from django.db import models


class ResultEnvelope(models.Model):
    run_session = models.OneToOneField("runs.RunSession", on_delete=models.CASCADE, related_name="result_envelope")
    trial_count = models.IntegerField(default=0)
    summary_json = models.JSONField(default=dict)
    encrypted_payload = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
