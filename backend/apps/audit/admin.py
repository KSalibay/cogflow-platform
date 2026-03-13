from django.contrib import admin

from apps.audit.models import AuditEvent


@admin.register(AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ["action", "resource_type", "resource_id", "actor", "created_at"]
    list_filter = ["action", "resource_type"]
    search_fields = ["resource_id", "actor", "action"]
    readonly_fields = ["created_at", "metadata_json"]
