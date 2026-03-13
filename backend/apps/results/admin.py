from django.contrib import admin

from apps.results.models import ResultEnvelope, TrialResult


@admin.register(ResultEnvelope)
class ResultEnvelopeAdmin(admin.ModelAdmin):
    list_display = ["run_session", "trial_count", "encryption_alg", "key_version", "created_at"]
    raw_id_fields = ["run_session"]
    readonly_fields = ["encrypted_payload", "created_at"]


@admin.register(TrialResult)
class TrialResultAdmin(admin.ModelAdmin):
    list_display = ["run_session", "trial_index", "task_name", "block_label", "rt_ms", "correct", "submitted_at"]
    list_filter = ["task_name", "correct"]
    search_fields = ["task_name", "block_label", "stimulus_key"]
    raw_id_fields = ["run_session"]
    readonly_fields = ["encrypted_payload", "submitted_at"]
