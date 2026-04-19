from rest_framework import serializers

from apps.users.models import UserProfile
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
    study_slug = serializers.SlugField(required=False)
    launch_token = serializers.CharField(required=False, allow_blank=True)
    participant_external_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, attrs):
        study_slug = attrs.get("study_slug")
        launch_token = (attrs.get("launch_token") or "").strip()
        if not study_slug and not launch_token:
            raise serializers.ValidationError("Either study_slug or launch_token is required")
        if launch_token:
            attrs["launch_token"] = launch_token
        return attrs


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


class AuthLoginRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128)


class AuthRegisterRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(max_length=128)


class TotpSetupRequestSerializer(serializers.Serializer):
    regenerate = serializers.BooleanField(required=False, default=False)


class TotpVerifyRequestSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=12)


class CreateParticipantLinkRequestSerializer(serializers.Serializer):
    participant_external_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    counterbalance_enabled = serializers.BooleanField(required=False, default=True)
    task_order = serializers.ListField(
        child=serializers.CharField(max_length=128),
        required=False,
        allow_empty=True,
        default=list,
    )
    task_order_strict = serializers.BooleanField(required=False, default=False)
    expires_in_hours = serializers.IntegerField(required=False, min_value=1, max_value=24 * 30, default=72)
    completion_redirect_url = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=2000)
    abort_redirect_url = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=2000)
    prolific_completion_mode = serializers.ChoiceField(
        choices=["default", "redirect", "show_code"],
        required=False,
        default="default",
    )
    prolific_completion_code = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=64)


class AssignStudyOwnerRequestSerializer(serializers.Serializer):
    owner_username = serializers.CharField(max_length=150)


class ShareStudyRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    can_remove_users = serializers.BooleanField(required=False, default=False)


class RevokeStudyAccessRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)


class DuplicateStudyRequestSerializer(serializers.Serializer):
    study_name = serializers.CharField(max_length=255, required=False, allow_blank=True)
    study_slug = serializers.SlugField(required=False, allow_blank=True)


class AdminCreateUserRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128)
    email = serializers.EmailField(required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=[c[0] for c in UserProfile.ROLE_CHOICES])
    is_active = serializers.BooleanField(required=False, default=True)


class AdminUpdateUserRoleRequestSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=[c[0] for c in UserProfile.ROLE_CHOICES])


class AdminUpdateUserActivationRequestSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()


class AdminSetUserPasswordRequestSerializer(serializers.Serializer):
    new_password = serializers.CharField(max_length=128)


class PasswordResetRequestSerializer(serializers.Serializer):
    identity = serializers.CharField(max_length=254)


class PasswordResetConfirmRequestSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2048)
    new_password = serializers.CharField(max_length=128)


class FeedbackSubmitRequestSerializer(serializers.Serializer):
    category = serializers.ChoiceField(
        choices=["bug", "feature", "ux", "other"],
        required=False,
        default="other",
    )
    subject = serializers.CharField(max_length=180, required=False, allow_blank=True)
    message = serializers.CharField(max_length=5000)
    contact_email = serializers.EmailField(required=False, allow_blank=True)


class CreditsEntrySerializer(serializers.Serializer):
    task_type = serializers.CharField(max_length=80)
    component_type = serializers.CharField(max_length=80)
    credit_role = serializers.CharField(max_length=80)
    contributor_username = serializers.CharField(max_length=150)
    notes = serializers.CharField(required=False, allow_blank=True)


class CreditsBulkUpdateRequestSerializer(serializers.Serializer):
    entries = CreditsEntrySerializer(many=True, required=False, default=list)
