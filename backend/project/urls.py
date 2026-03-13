from django.contrib import admin
from django.urls import path
from rest_framework.renderers import JSONOpenAPIRenderer
from rest_framework.schemas import get_schema_view

from project.api_views import (
    HealthView,
    PublishConfigView,
    StartRunView,
    SubmitResultView,
    StudiesListView,
)

schema_view = get_schema_view(
    title="CogFlow Platform API",
    description="OpenAPI schema for CogFlow Platform v1 endpoints.",
    version="1.0.0",
    renderer_classes=[JSONOpenAPIRenderer],
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", HealthView.as_view(), name="healthz"),
    path("api/schema", schema_view, name="openapi-schema"),
    path("api/v1/studies", StudiesListView.as_view(), name="studies-list"),
    path("api/v1/configs/publish", PublishConfigView.as_view(), name="configs-publish"),
    path("api/v1/runs/start", StartRunView.as_view(), name="runs-start"),
    path("api/v1/results/submit", SubmitResultView.as_view(), name="results-submit"),
]
