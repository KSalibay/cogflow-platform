from django.db import models

from project.constants import RUNTIME_MODE_CHOICES, RUNTIME_MODE_DJANGO


class Study(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=255)
    owner_user = models.ForeignKey(
        "auth.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_studies",
    )
    runtime_mode = models.CharField(max_length=20, choices=RUNTIME_MODE_CHOICES, default=RUNTIME_MODE_DJANGO)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.slug
