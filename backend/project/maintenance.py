import os
from dataclasses import dataclass

from django.http import JsonResponse
from django.shortcuts import render


@dataclass(frozen=True)
class MaintenanceConfig:
    enabled: bool
    retry_hours: int
    message: str
    window_label: str
    allow_admin: bool


def _is_truthy(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _read_config() -> MaintenanceConfig:
    retry_raw = os.getenv("COGFLOW_MAINTENANCE_RETRY_HOURS", "5").strip()
    try:
        retry_hours = max(1, int(retry_raw))
    except ValueError:
        retry_hours = 5

    window_label = os.getenv("COGFLOW_MAINTENANCE_WINDOW", "Friday 7:00 PM to 12:00 AM (Sydney time)").strip()
    if not window_label:
        window_label = "Friday 7:00 PM to 12:00 AM (Sydney time)"

    default_message = (
        "CogFlow Platform is temporarily unavailable for scheduled maintenance. "
        f"Please check back in about {retry_hours} hours."
    )
    message = os.getenv("COGFLOW_MAINTENANCE_MESSAGE", "").strip() or default_message

    return MaintenanceConfig(
        enabled=_is_truthy(os.getenv("COGFLOW_MAINTENANCE_MODE", "0")),
        retry_hours=retry_hours,
        message=message,
        window_label=window_label,
        allow_admin=_is_truthy(os.getenv("COGFLOW_MAINTENANCE_ALLOW_ADMIN", "1")),
    )


class PlatformMaintenanceMiddleware:
    """Globally block platform access when maintenance mode is enabled."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        cfg = _read_config()
        path = (request.path or "").strip()

        if not cfg.enabled or self._is_exempt_path(path, cfg.allow_admin):
            return self.get_response(request)

        if path.startswith("/api/"):
            return JsonResponse(
                {
                    "error": "maintenance_mode",
                    "message": cfg.message,
                    "retry_after_hours": cfg.retry_hours,
                    "maintenance_window": cfg.window_label,
                },
                status=503,
            )

        context = {
            "maintenance_message": cfg.message,
            "maintenance_window": cfg.window_label,
            "retry_after_hours": cfg.retry_hours,
            "support_email": os.getenv("COGFLOW_SUPPORT_EMAIL", "support@cogflow.app").strip() or "support@cogflow.app",
        }
        return render(request, "maintenance.html", context=context, status=503)

    @staticmethod
    def _is_exempt_path(path: str, allow_admin: bool) -> bool:
        if not path:
            return False

        exempt_exact = {
            "/healthz",
            "/api/schema",
            "/favicon.ico",
        }
        exempt_prefixes = (
            "/portal/assets/",
            "/static/",
            "/media/",
        )

        if path in exempt_exact:
            return True

        if any(path.startswith(prefix) for prefix in exempt_prefixes):
            return True

        if allow_admin and path.startswith("/admin/"):
            return True

        return False
