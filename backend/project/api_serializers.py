from rest_framework import serializers

from project.constants import (
    RUNTIME_MODE_CHOICES,
    RUNTIME_MODE_DJANGO,
    RUN_STATUS_COMPLETED,
    RUN_STATUS_FAILED,
)


class PublishConfigRequestSerializer(serializers.Serializer):
    study_slug = serializers.SlugField()
    study_name = serializers.CharField(max_length=255)
    config_version_label = serializers.CharField(max_length=50)
    builder_version = serializers.CharField(max_length=50, required=False, allow_blank=True)
    runtime_mode = serializers.ChoiceField(choices=RUNTIME_MODE_CHOICES, default=RUNTIME_MODE_DJANGO)
    config = serializers.JSONField()


class StartRunRequestSerializer(serializers.Serializer):
    study_slug = serializers.SlugField()
    participant_external_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class SubmitResultRequestSerializer(serializers.Serializer):
    run_session_id = serializers.UUIDField()
    status = serializers.ChoiceField(
        choices=[(RUN_STATUS_COMPLETED, "Completed"), (RUN_STATUS_FAILED, "Failed")],
        default=RUN_STATUS_COMPLETED,
    )
    trial_count = serializers.IntegerField(min_value=0)
    result_summary = serializers.JSONField(required=False)
    result_payload = serializers.JSONField()
    # Optional per-trial data; each element is an arbitrary task-specific dict.
    trials = serializers.ListField(child=serializers.JSONField(), required=False, default=list)


class DecryptResultRequestSerializer(serializers.Serializer):
    run_session_id = serializers.UUIDField()
    include_trials = serializers.BooleanField(required=False, default=False)
