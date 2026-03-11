from django.db import models


class Study(models.Model):
    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=255)
    runtime_mode = models.CharField(max_length=20, default="django")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.slug
