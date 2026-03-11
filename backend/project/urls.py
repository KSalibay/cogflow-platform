from django.contrib import admin
from django.urls import path

from project.api_views import (
    HealthView,
    PublishConfigView,
    StartRunView,
    SubmitResultView,
    StudiesListView,
)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("healthz", HealthView.as_view(), name="healthz"),
    path("api/v1/studies", StudiesListView.as_view(), name="studies-list"),
    path("api/v1/configs/publish", PublishConfigView.as_view(), name="configs-publish"),
    path("api/v1/runs/start", StartRunView.as_view(), name="runs-start"),
    path("api/v1/results/submit", SubmitResultView.as_view(), name="results-submit"),
]
