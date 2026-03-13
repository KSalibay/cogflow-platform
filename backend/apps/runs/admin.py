from django.contrib import admin

from apps.runs.models import RunSession


@admin.register(RunSession)
class RunSessionAdmin(admin.ModelAdmin):
    list_display = ["id", "study", "participant_key", "status", "started_at", "completed_at"]
    list_filter = ["status", "study"]
    search_fields = ["participant_key"]
    raw_id_fields = ["study", "config_version"]
    readonly_fields = ["id", "started_at"]
