from django.contrib import admin

from apps.studies.models import Study


@admin.register(Study)
class StudyAdmin(admin.ModelAdmin):
    list_display = ["slug", "name", "runtime_mode", "is_active", "updated_at"]
    list_filter = ["runtime_mode", "is_active"]
    search_fields = ["slug", "name"]
    prepopulated_fields = {"slug": ("name",)}
    readonly_fields = ["created_at", "updated_at"]
