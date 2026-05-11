from django.conf import settings
from django.contrib import admin
from django.urls import path, re_path
from django.views.static import serve as static_serve
from rest_framework.renderers import JSONOpenAPIRenderer
from rest_framework.schemas import get_schema_view

from project.api_views import (
    AdminUserActivationView,
    AdminUserDeleteView,
    AdminUserPasswordView,
    AdminUserRoleView,
    AdminUsersView,
    AuthCsrfView,
    AssignStudyOwnerView,
    AuthLoginView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    AuthRegisterView,
    AuthRegisterVerifyView,
    AuthLogoutView,
    AuthMeView,
    FeedbackSubmitView,
    CreditsView,
    BuilderAppView,
    CreateParticipantLinkView,
    DeleteStudyView,
    DecryptResultView,
    DuplicateStudyView,
    HealthView,
    InterpreterAppView,
    DownloadBuilderAssetView,
    UploadBuilderAssetView,
    PortalDashboardView,
    PublishConfigView,
    RevokeStudyAccessView,
    ShareStudyView,
    ShareStudyValidateUserView,
    StartRunView,
    StudyLatestConfigView,
    DeleteStudyConfigVersionView,
    StudyAnalysisReportView,
    StudyAnalysisReportJobsView,
    StudyAnalysisReportJobDetailView,
    StudyAnalysisReportArtifactDownloadView,
    StudyAnalysisReportJobCancelView,
    StudyAnalysisReportJobDeleteView,
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

_portal_assets_dir = settings.BASE_DIR / "project" / "templates" / "portal" / "assets"

schema_view = get_schema_view(
    title="CogFlow Platform API",
    description="OpenAPI schema for CogFlow Platform v1 endpoints.",
    version="1.0.0",
    renderer_classes=[JSONOpenAPIRenderer],
)

urlpatterns = [
    path("admin/", admin.site.urls),
    re_path(
        r"^favicon\.ico$",
        static_serve,
        {"path": "favicon.ico", "document_root": str(_portal_assets_dir)},
    ),
    re_path(r"^portal/assets/(?P<path>.+)$", static_serve, {"document_root": str(_portal_assets_dir)}),
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
    path("api/v1/auth/csrf", AuthCsrfView.as_view(), name="auth-csrf"),
    path("api/v1/auth/register", AuthRegisterView.as_view(), name="auth-register"),
    path("api/v1/auth/register/verify", AuthRegisterVerifyView.as_view(), name="auth-register-verify"),
    path("api/v1/auth/password/reset/request", PasswordResetRequestView.as_view(), name="auth-password-reset-request"),
    path("api/v1/auth/password/reset/confirm", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    path("api/v1/auth/logout", AuthLogoutView.as_view(), name="auth-logout"),
    path("api/v1/auth/me", AuthMeView.as_view(), name="auth-me"),
    path("api/v1/auth/mfa/setup", TotpSetupView.as_view(), name="auth-mfa-setup"),
    path("api/v1/auth/mfa/verify", TotpVerifyView.as_view(), name="auth-mfa-verify"),
    path("api/v1/auth/mfa/disable", TotpDisableView.as_view(), name="auth-mfa-disable"),
    path("api/v1/auth/password/change", PasswordChangeView.as_view(), name="auth-password-change"),
    path("api/v1/feedback/submit", FeedbackSubmitView.as_view(), name="feedback-submit"),
    path("api/v1/credits", CreditsView.as_view(), name="credits"),
    path("api/v1/admin/users", AdminUsersView.as_view(), name="admin-users"),
    path("api/v1/admin/users/<int:user_id>/password", AdminUserPasswordView.as_view(), name="admin-user-password"),
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
        "api/v1/studies/<slug:study_slug>/share",
        ShareStudyView.as_view(),
        name="studies-share",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/share/validate-user",
        ShareStudyValidateUserView.as_view(),
        name="studies-share-validate-user",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/share/remove",
        RevokeStudyAccessView.as_view(),
        name="studies-share-remove",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/duplicate",
        DuplicateStudyView.as_view(),
        name="studies-duplicate",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/delete",
        DeleteStudyView.as_view(),
        name="studies-delete",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/configs/<int:config_version_id>/delete",
        DeleteStudyConfigVersionView.as_view(),
        name="studies-config-delete",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/runs",
        StudyRunsView.as_view(),
        name="studies-runs",
    ),
    path(
        "api/v1/studies/<slug:study_slug>/latest-config",
        StudyLatestConfigView.as_view(),
        name="studies-latest-config",
    ),
    path(
        "api/v1/studies/analysis/report",
        StudyAnalysisReportView.as_view(),
        name="studies-analysis-report",
    ),
    path(
        "api/v1/studies/analysis/jobs",
        StudyAnalysisReportJobsView.as_view(),
        name="studies-analysis-jobs",
    ),
    path(
        "api/v1/studies/analysis/jobs/<int:job_id>",
        StudyAnalysisReportJobDetailView.as_view(),
        name="studies-analysis-job-detail",
    ),
    path(
        "api/v1/studies/analysis/jobs/<int:job_id>/artifacts/<slug:artifact_format>",
        StudyAnalysisReportArtifactDownloadView.as_view(),
        name="studies-analysis-job-artifact",
    ),
    path(
        "api/v1/studies/analysis/jobs/<int:job_id>/cancel",
        StudyAnalysisReportJobCancelView.as_view(),
        name="studies-analysis-job-cancel",
    ),
    path(
        "api/v1/studies/analysis/jobs/<int:job_id>/delete",
        StudyAnalysisReportJobDeleteView.as_view(),
        name="studies-analysis-job-delete",
    ),
    path("api/v1/configs/publish", PublishConfigView.as_view(), name="configs-publish"),
    path("api/v1/assets/upload", UploadBuilderAssetView.as_view(), name="assets-upload"),
    path("api/v1/assets/file/<path:asset_path>", DownloadBuilderAssetView.as_view(), name="assets-file"),
    path("api/v1/runs/start", StartRunView.as_view(), name="runs-start"),
    path("api/v1/results/submit", SubmitResultView.as_view(), name="results-submit"),
    path("api/v1/results/decrypt", DecryptResultView.as_view(), name="results-decrypt"),
    re_path(r"^media/(?P<asset_path>builder-assets/.+)$", DownloadBuilderAssetView.as_view()),
    re_path(r"^media/(?P<path>.+)$", static_serve, {"document_root": str(settings.MEDIA_ROOT)}),
]
