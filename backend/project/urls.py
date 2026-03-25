from django.conf import settings
from django.contrib import admin
from django.urls import path, re_path
from django.views.static import serve as static_serve
from rest_framework.renderers import JSONOpenAPIRenderer
from rest_framework.schemas import get_schema_view

from project.api_views import (
    AdminUserActivationView,
    AdminUserDeleteView,
    AdminUserRoleView,
    AdminUsersView,
    AssignStudyOwnerView,
    AuthLoginView,
    AuthRegisterView,
    AuthLogoutView,
    AuthMeView,
    BuilderAppView,
    CreateParticipantLinkView,
    DecryptResultView,
    HealthView,
    InterpreterAppView,
    PortalDashboardView,
    PublishConfigView,
    StartRunView,
    StudyRunsView,
    SubmitResultView,
    StudiesListView,
    TotpSetupView,
    TotpVerifyView,
)
from project.api_views import TotpDisableView, PasswordChangeView

# Resolve builder assets directory — works both in Docker (mounted at BASE_DIR/frontend)
# and in local dev (repo layout: backend/../frontend).
_builder_dir = settings.BASE_DIR / "frontend" / "builder"
if not _builder_dir.exists():
    _builder_dir = settings.BASE_DIR.parent / "frontend" / "builder"

_interpreter_dir = settings.BASE_DIR / "frontend" / "interpreter"
if not _interpreter_dir.exists():
    _interpreter_dir = settings.BASE_DIR.parent / "frontend" / "interpreter"

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
    path("builder/", BuilderAppView.as_view(), name="builder-app"),
    re_path(r"^builder/(?P<path>.+)$", static_serve, {"document_root": str(_builder_dir)}),
    path("interpreter/", InterpreterAppView.as_view(), name="interpreter-app"),
    path("interpreter/index.html", InterpreterAppView.as_view(), name="interpreter-index"),
    re_path(r"^interpreter/(?P<path>.+)$", static_serve, {"document_root": str(_interpreter_dir)}),
    path("healthz", HealthView.as_view(), name="healthz"),
    path("api/schema", schema_view, name="openapi-schema"),
    path("api/v1/auth/login", AuthLoginView.as_view(), name="auth-login"),
    path("api/v1/auth/register", AuthRegisterView.as_view(), name="auth-register"),
    path("api/v1/auth/logout", AuthLogoutView.as_view(), name="auth-logout"),
    path("api/v1/auth/me", AuthMeView.as_view(), name="auth-me"),
    path("api/v1/auth/mfa/setup", TotpSetupView.as_view(), name="auth-mfa-setup"),
    path("api/v1/auth/mfa/verify", TotpVerifyView.as_view(), name="auth-mfa-verify"),
    path("api/v1/auth/mfa/disable", TotpDisableView.as_view(), name="auth-mfa-disable"),
    path("api/v1/auth/password/change", PasswordChangeView.as_view(), name="auth-password-change"),
    path("api/v1/admin/users", AdminUsersView.as_view(), name="admin-users"),
    path("api/v1/admin/users/<int:user_id>/role", AdminUserRoleView.as_view(), name="admin-user-role"),
    path("api/v1/admin/users/<int:user_id>/activation", AdminUserActivationView.as_view(), name="admin-user-activation"),
    path("api/v1/admin/users/<int:user_id>/delete", AdminUserDeleteView.as_view(), name="admin-user-delete"),
    path("api/v1/studies", StudiesListView.as_view(), name="studies-list"),
    path(
        "api/v1/studies/<slug:study_slug>/participant-links",
        CreateParticipantLinkView.as_view(),
        name="studies-participant-links",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/owner",
        AssignStudyOwnerView.as_view(),
        name="studies-assign-owner",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/runs",
        StudyRunsView.as_view(),
        name="studies-runs",
    ),
    path("api/v1/configs/publish", PublishConfigView.as_view(), name="configs-publish"),
    path("api/v1/runs/start", StartRunView.as_view(), name="runs-start"),
    path("api/v1/results/submit", SubmitResultView.as_view(), name="results-submit"),
    path("api/v1/results/decrypt", DecryptResultView.as_view(), name="results-decrypt"),
]
