from django.contrib import admin
from django.urls import path
from rest_framework.renderers import JSONOpenAPIRenderer
from rest_framework.schemas import get_schema_view

from project.api_views import (
    AuthLoginView,
    AuthLogoutView,
    DecryptResultView,
    HealthView,
    PortalDashboardView,
    PublishConfigView,
    StartRunView,
    SubmitResultView,
    StudiesListView,
    TotpSetupView,
    TotpVerifyView,
)

schema_view = get_schema_view(
    title="CogFlow Platform API",
    description="OpenAPI schema for CogFlow Platform v1 endpoints.",
    version="1.0.0",
    renderer_classes=[JSONOpenAPIRenderer],
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", PortalDashboardView.as_view(), name="portal-home"),
    path("index.html", PortalDashboardView.as_view(), name="portal-index"),
    path("portal/", PortalDashboardView.as_view(), name="portal-dashboard"),
    path("healthz", HealthView.as_view(), name="healthz"),
    path("api/schema", schema_view, name="openapi-schema"),
    path("api/v1/auth/login", AuthLoginView.as_view(), name="auth-login"),
    path("api/v1/auth/logout", AuthLogoutView.as_view(), name="auth-logout"),
    path("api/v1/auth/mfa/setup", TotpSetupView.as_view(), name="auth-mfa-setup"),
    path("api/v1/auth/mfa/verify", TotpVerifyView.as_view(), name="auth-mfa-verify"),
    path("api/v1/studies", StudiesListView.as_view(), name="studies-list"),
    path("api/v1/configs/publish", PublishConfigView.as_view(), name="configs-publish"),
    path("api/v1/runs/start", StartRunView.as_view(), name="runs-start"),
    path("api/v1/results/submit", SubmitResultView.as_view(), name="results-submit"),
    path("api/v1/results/decrypt", DecryptResultView.as_view(), name="results-decrypt"),
]
