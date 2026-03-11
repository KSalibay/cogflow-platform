from rest_framework import serializers


class PublishConfigRequestSerializer(serializers.Serializer):
    study_slug = serializers.SlugField()
    study_name = serializers.CharField(max_length=255)
    config_version_label = serializers.CharField(max_length=50)
    builder_version = serializers.CharField(max_length=50, required=False, allow_blank=True)
    runtime_mode = serializers.ChoiceField(choices=["django", "jatos", "hybrid"], default="django")
    config = serializers.JSONField()


class StartRunRequestSerializer(serializers.Serializer):
    study_slug = serializers.SlugField()
    participant_external_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class SubmitResultRequestSerializer(serializers.Serializer):
    run_session_id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["completed", "failed"], default="completed")
    trial_count = serializers.IntegerField(min_value=0)
    result_summary = serializers.JSONField(required=False)
    result_payload = serializers.JSONField()
