from django.contrib import admin

from apps.configs.models import ConfigVersion


@admin.register(ConfigVersion)
class ConfigVersionAdmin(admin.ModelAdmin):
    list_display = ["study", "version_label", "builder_version", "created_at"]
    list_filter = ["study"]
    search_fields = ["version_label", "builder_version"]
    raw_id_fields = ["study"]
    readonly_fields = ["created_at"]
