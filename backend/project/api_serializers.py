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
    requested_role = serializers.ChoiceField(
        choices=[UserProfile.ROLE_RESEARCHER, UserProfile.ROLE_ANALYST],
        required=False,
        default=UserProfile.ROLE_RESEARCHER,
    )


class TotpSetupRequestSerializer(serializers.Serializer):
    regenerate = serializers.BooleanField(required=False, default=False)


class TotpVerifyRequestSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=12)


class CreateParticipantLinkRequestSerializer(serializers.Serializer):
    participant_external_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    counterbalance_enabled = serializers.BooleanField(required=False, default=True)
    use_flow_variants = serializers.BooleanField(required=False, default=False)
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

    def validate(self, attrs):
        if attrs.get("use_flow_variants") and attrs.get("task_order"):
            raise serializers.ValidationError("use_flow_variants cannot be combined with task_order")
        return attrs


class StudyPropertiesRequestSerializer(serializers.Serializer):
    task_profile = serializers.JSONField(required=False, default=dict)
    flow_variants = serializers.ListField(child=serializers.JSONField(), required=False, default=list)


class AssignStudyOwnerRequestSerializer(serializers.Serializer):
    owner_username = serializers.CharField(max_length=150)


class ShareStudyRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    can_remove_users = serializers.BooleanField(required=False, default=False)
    can_run_analysis = serializers.BooleanField(required=False, default=True)
    can_download_aggregate = serializers.BooleanField(required=False, default=True)
    can_view_run_rows = serializers.BooleanField(required=False, default=False)
    can_view_pseudonyms = serializers.BooleanField(required=False, default=False)
    can_view_full_payload = serializers.BooleanField(required=False, default=False)
    can_manage_sharing = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        if attrs.get("can_view_full_payload") and not attrs.get("can_view_run_rows"):
            raise serializers.ValidationError(
                "can_view_full_payload requires can_view_run_rows"
            )
        if attrs.get("can_view_pseudonyms") and not attrs.get("can_view_run_rows"):
            raise serializers.ValidationError(
                "can_view_pseudonyms requires can_view_run_rows"
            )
        if not attrs.get("can_run_analysis", True) and attrs.get("can_download_aggregate", True):
            raise serializers.ValidationError(
                "can_download_aggregate requires can_run_analysis"
            )
        return attrs


class ShareStudyValidateUserRequestSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)


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


class StudyAnalysisReportRequestSerializer(serializers.Serializer):
    study_slug = serializers.SlugField()
    engine = serializers.ChoiceField(choices=["python", "r"], default="python")
    include_completed_only = serializers.BooleanField(required=False, default=True)
    options = serializers.JSONField(required=False, default=dict)

    def validate_options(self, value):
        opts = value if isinstance(value, dict) else {}
        fields_of_interest = opts.get("fields_of_interest", [])
        if isinstance(fields_of_interest, str):
            fields_of_interest = [x.strip() for x in fields_of_interest.split(",") if x.strip()]
        if not isinstance(fields_of_interest, list):
            fields_of_interest = []
        fields_of_interest = [str(x).strip().lower() for x in fields_of_interest if str(x).strip()]

        trial_categories = opts.get("trial_categories", ["all"])
        if isinstance(trial_categories, str):
            trial_categories = [trial_categories]
        if not isinstance(trial_categories, list):
            trial_categories = ["all"]
        trial_categories = [str(x).strip().lower() for x in trial_categories if str(x).strip()]
        if not trial_categories or "all" in trial_categories:
            trial_categories = ["all"]

        normalized = {
            "include_overview": bool(opts.get("include_overview", True)),
            "include_numeric_summary": bool(opts.get("include_numeric_summary", True)),
            "include_field_coverage": bool(opts.get("include_field_coverage", True)),
            "include_config_fields": bool(opts.get("include_config_fields", False)),
            "include_participant_summary": bool(opts.get("include_participant_summary", False)),
            "fields_of_interest": fields_of_interest,
            "trial_categories": trial_categories,
            "max_variables": int(opts.get("max_variables", 20) or 20),
            "max_participants": int(opts.get("max_participants", 25) or 25),
        }
        normalized["max_variables"] = max(1, min(200, normalized["max_variables"]))
        normalized["max_participants"] = max(1, min(200, normalized["max_participants"]))
        return normalized


class StudyAnalysisReportJobCreateRequestSerializer(StudyAnalysisReportRequestSerializer):
    requested_formats = serializers.ListField(
        child=serializers.ChoiceField(choices=["markdown", "html", "pdf", "rmd", "snapshot"]),
        required=False,
        default=lambda: ["markdown", "html", "pdf", "snapshot"],
    )

    def validate_requested_formats(self, value):
        ordered = []
        for item in value or []:
            fmt = str(item or "").strip().lower()
            if fmt and fmt not in ordered:
                ordered.append(fmt)
        return ordered or ["markdown", "html", "pdf", "snapshot"]
