from django.contrib.auth.models import User
from django.db import models


class UserProfile(models.Model):
    """Extends Django's built-in User with platform-specific metadata.

    Role is stored here to keep auth.User unmodified; RBAC expansion
    (per-study permissions, org membership) belongs in Week 2.
    """

    ROLE_ADMIN = "platform_admin"
    ROLE_RESEARCHER = "researcher"
    ROLE_ANALYST = "analyst"
    ROLE_PARTICIPANT = "participant"

    ROLE_CHOICES = [
        (ROLE_ADMIN, "Platform Admin"),
        (ROLE_RESEARCHER, "Researcher"),
        (ROLE_ANALYST, "Analyst"),
        (ROLE_PARTICIPANT, "Participant"),
    ]

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(max_length=50, choices=ROLE_CHOICES, default=ROLE_RESEARCHER)
    mfa_enabled = models.BooleanField(default=False)
    mfa_totp_secret_encrypted = models.TextField(blank=True, default="")
    mfa_last_verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.user.username} ({self.role})"
