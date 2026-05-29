from django.contrib import admin

from apps.users.models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "public_name", "role", "mfa_enabled", "mfa_last_verified_at", "created_at"]
    list_filter = ["role"]
    search_fields = ["user__username", "user__email", "public_name"]
    raw_id_fields = ["user"]
    readonly_fields = ["created_at", "mfa_last_verified_at"]
