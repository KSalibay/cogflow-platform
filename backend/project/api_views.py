import os
import json
import re
import hashlib
import math
from datetime import timedelta
from uuid import uuid4
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import pyotp
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.core import signing
from django.core.files.storage import default_storage
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.utils.text import slugify
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.response import Response
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion, TaskCreditRow
from apps.runs.models import RunSession
from apps.studies.models import Study, StudyResearcherAccess
from apps.users.models import UserProfile
from apps.users.services import get_or_create_profile
from apps.results.models import ResultEnvelope
from apps.results.services import (
    get_decrypted_envelope,
    get_decrypted_trial,
    store_result_envelope,
    store_trial_results,
)
from project.api_serializers import (
    AdminCreateUserRequestSerializer,
    AdminSetUserPasswordRequestSerializer,
    AdminUpdateUserActivationRequestSerializer,
    AdminUpdateUserRoleRequestSerializer,
    AssignStudyOwnerRequestSerializer,
    CreditsBulkUpdateRequestSerializer,
    DuplicateStudyRequestSerializer,
    RevokeStudyAccessRequestSerializer,
    ShareStudyRequestSerializer,
    AuthLoginRequestSerializer,
    PasswordResetConfirmRequestSerializer,
    PasswordResetRequestSerializer,
    AuthRegisterRequestSerializer,
    FeedbackSubmitRequestSerializer,
    CreateParticipantLinkRequestSerializer,
    DecryptResultRequestSerializer,
    PublishConfigRequestSerializer,
    StartRunRequestSerializer,
    SubmitResultRequestSerializer,
    TotpSetupRequestSerializer,
    TotpVerifyRequestSerializer,
)
from project.constants import RUN_STATUS_COMPLETED
from project.security import decrypt_payload, encrypt_payload, hash_identifier


def record_audit(
    action: str,
    resource_type: str,
    resource_id: str,
    metadata: dict | None = None,
    actor: str = "system",
) -> None:
    AuditEvent.objects.create(
        actor=actor,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        metadata_json=metadata or {},
    )


class HealthView(APIView):
    def get(self, request):
        return Response({"ok": True})


def _get_actor_from_request(request) -> str:
    if getattr(request, "user", None) and request.user.is_authenticated:
        return request.user.username
    return (request.headers.get("X-CogFlow-Actor") or "unknown").strip() or "unknown"


def _mark_mfa_verified(request) -> str:
    now_iso = timezone.now().isoformat()
    request.session["mfa_verified_at"] = now_iso
    request.session.modified = True
    return now_iso


def _is_mfa_session_fresh(request) -> bool:
    stamp = request.session.get("mfa_verified_at")
    if not stamp:
        return False
    try:
        ts = timezone.datetime.fromisoformat(stamp)
    except Exception:
        return False
    if timezone.is_naive(ts):
        ts = timezone.make_aware(ts)
    max_age_seconds = int(os.getenv("MFA_REAUTH_SECONDS", "900"))
    return timezone.now() - ts <= timedelta(seconds=max_age_seconds)


def _can_manage_researcher_resources(request, profile) -> bool:
    if not request.user.is_authenticated:
        return False
    return profile.role in {profile.ROLE_ADMIN, profile.ROLE_RESEARCHER}


def _require_platform_admin(request):
    if not request.user.is_authenticated:
        return None, Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    profile = get_or_create_profile(request.user)
    if profile.role != profile.ROLE_ADMIN:
        return None, Response({"error": "Platform admin role required"}, status=status.HTTP_403_FORBIDDEN)
    return profile, None


def _get_study_owner_username(study: Study) -> str | None:
    if study.owner_user_id:
        return study.owner_user.username

    shared_owner = (
        StudyResearcherAccess.objects.filter(study=study)
        .select_related("user")
        .order_by("id")
        .first()
    )
    if shared_owner:
        return shared_owner.user.username

    evt = (
        AuditEvent.objects.filter(
            action="publish_config",
            resource_type="study",
            resource_id=str(study.id),
        )
        .order_by("-id")
        .first()
    )
    return evt.actor if evt else None


def _get_study_owner_usernames(study: Study) -> list[str]:
    names: list[str] = []
    if study.owner_user_id:
        names.append(study.owner_user.username)

    for username in (
        StudyResearcherAccess.objects.filter(study=study)
        .select_related("user")
        .values_list("user__username", flat=True)
    ):
        if username and username not in names:
            names.append(username)

    if not names:
        fallback = _get_study_owner_username(study)
        if fallback:
            names.append(fallback)

    return names


def _has_study_access(study: Study, user, profile) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if study.owner_user_id == user.id:
        return True
    return StudyResearcherAccess.objects.filter(study=study, user=user).exists()


def _can_remove_study_users(study: Study, user, profile) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if profile.role == profile.ROLE_ADMIN:
        return True
    if study.owner_user_id == user.id:
        return True
    return StudyResearcherAccess.objects.filter(
        study=study,
        user=user,
        can_remove_users=True,
    ).exists()


def _issue_launch_token(payload: dict) -> str:
    return signing.dumps(payload, salt="participant-launch-v1", compress=True)


def _read_launch_token(token: str) -> dict:
    return signing.loads(token, salt="participant-launch-v1", max_age=60 * 60 * 24 * 30)


def _launch_token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _resolve_redirect_url(
    template: str | None,
    participant_external_id: str,
    participant_key: str,
    run_session_id,
) -> str | None:
    raw = (template or "").strip()
    if not raw:
        return None

    replacements = {
        "participant_external_id": participant_external_id,
        "participant_key": participant_key,
        "run_session_id": str(run_session_id),
    }

    resolved = raw
    for key, value in replacements.items():
        encoded_value = quote((value or "").strip(), safe="")
        resolved = resolved.replace("{" + key + "}", encoded_value)

    return resolved


def _extract_config_task_type(config_json: dict | None) -> str | None:
    if not isinstance(config_json, dict):
        return None
    raw = config_json.get("task_type")
    if raw is None:
        raw = config_json.get("taskType")
    s = str(raw or "").strip().lower()
    return s or None


SCHEMA_COMPONENT_TYPES = [
    "block",
    "flanker-trial",
    "gabor-trial",
    "html-button-response",
    "html-keyboard-response",
    "image-keyboard-response",
    "instructions",
    "mot-trial",
    "nback-block",
    "nback-trial-sequence",
    "preload",
    "pvt-trial",
    "reward-settings",
    "sart-trial",
    "simon-trial",
    "soc-dashboard",
    "soc-dashboard-icon",
    "soc-subtask-flanker-like",
    "soc-subtask-nback-like",
    "soc-subtask-pvt-like",
    "soc-subtask-sart-like",
    "soc-subtask-wcst-like",
    "stroop-trial",
    "survey-response",
    "task-switching-trial",
    "visual-angle-calibration",
]

CREDIT_ROLES = [
    "Conceptualization",
    "Data curation",
    "Formal Analysis",
    "Funding acquisition",
    "Investigation",
    "Methodology",
    "Project administration",
    "Resources",
    "Software",
    "Supervision",
    "Validation",
    "Visualization",
    "Writing - original draft",
    "Writing - review & editing",
]

TASK_SCOPE_DEFINITIONS = [
    {"task_type": "rdm", "components": ["block"]},
    {"task_type": "flanker", "components": ["flanker-trial", "block"]},
    {"task_type": "sart", "components": ["sart-trial", "block"]},
    {"task_type": "stroop", "components": ["stroop-trial", "block"]},
    {"task_type": "simon", "components": ["simon-trial", "block"]},
    {"task_type": "pvt", "components": ["pvt-trial", "block"]},
    {"task_type": "task-switching", "components": ["task-switching-trial", "block"]},
    {"task_type": "gabor", "components": ["gabor-trial", "block"]},
    {"task_type": "nback", "components": ["nback-trial-sequence", "nback-block", "block"]},
    {"task_type": "mot", "components": ["mot-trial", "block"]},
    {
        "task_type": "soc-dashboard",
        "components": [
            "soc-dashboard",
            "soc-dashboard-icon",
            "soc-subtask-flanker-like",
            "soc-subtask-nback-like",
            "soc-subtask-pvt-like",
            "soc-subtask-sart-like",
            "soc-subtask-wcst-like",
        ],
    },
    {
        "task_type": "custom",
        "components": [
            "instructions",
            "html-button-response",
            "html-keyboard-response",
            "image-keyboard-response",
            "survey-response",
            "preload",
            "reward-settings",
            "visual-angle-calibration",
            "block",
        ],
    },
]


class CreditsView(APIView):
    """Fetch/update CRediT assignments grouped by task scopes."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        schema_set = set(SCHEMA_COMPONENT_TYPES)
        task_scopes = []
        task_scope_map = {}
        for row in TASK_SCOPE_DEFINITIONS:
            task_type = str(row["task_type"])
            components = [c for c in row["components"] if c in schema_set]
            task_scopes.append({"task_type": task_type, "components": components})
            task_scope_map[task_type] = set(components)

        rows = []
        for x in TaskCreditRow.objects.select_related("updated_by").all():
            rows.append(
                {
                    "id": x.id,
                    "task_type": x.task_type,
                    "component_type": x.component_type,
                    "credit_role": x.credit_role,
                    "contributor_username": x.contributor_username,
                    "notes": x.notes,
                    "updated_by": (x.updated_by.username if x.updated_by else None),
                    "updated_at": x.updated_at,
                }
            )

        usernames = list(
            User.objects.filter(is_active=True)
            .order_by("username")
            .values_list("username", flat=True)
        )

        return Response(
            {
                "ok": True,
                "schema_source": "docs/reference/plugins/plugin_schema_reference.md",
                "component_count": len(SCHEMA_COMPONENT_TYPES),
                "schema_components": SCHEMA_COMPONENT_TYPES,
                "task_scopes": task_scopes,
                "credit_roles": CREDIT_ROLES,
                "usernames": usernames,
                "entries": rows,
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = CreditsBulkUpdateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entries = serializer.validated_data["entries"]

        schema_set = set(SCHEMA_COMPONENT_TYPES)
        valid_task_scopes = {
            str(x["task_type"]): set(c for c in x["components"] if c in schema_set)
            for x in TASK_SCOPE_DEFINITIONS
        }
        credit_roles_set = set(CREDIT_ROLES)
        active_users = set(
            User.objects.filter(is_active=True).values_list("username", flat=True)
        )

        unknown_task_types = sorted(
            {
                str(e.get("task_type", "")).strip()
                for e in entries
                if str(e.get("task_type", "")).strip() not in valid_task_scopes
            }
        )
        if unknown_task_types:
            return Response(
                {
                    "error": "Unknown task_type values",
                    "unknown": unknown_task_types,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        unknown = sorted(
            {
                str(e.get("component_type", "")).strip()
                for e in entries
                if str(e.get("component_type", "")).strip() not in schema_set
            }
        )
        if unknown:
            return Response(
                {
                    "error": "Unknown component_type values",
                    "unknown": unknown,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        invalid_task_scope_pairs = []
        unknown_roles = sorted(
            {
                str(e.get("credit_role", "")).strip()
                for e in entries
                if str(e.get("credit_role", "")).strip() not in credit_roles_set
            }
        )
        if unknown_roles:
            return Response(
                {
                    "error": "Unknown credit_role values",
                    "unknown": unknown_roles,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        unknown_users = sorted(
            {
                str(e.get("contributor_username", "")).strip()
                for e in entries
                if str(e.get("contributor_username", "")).strip() not in active_users
            }
        )
        if unknown_users:
            return Response(
                {
                    "error": "Unknown contributor_username values",
                    "unknown": unknown_users,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        prepared = []
        for entry in entries:
            task_type = str(entry.get("task_type", "") or "").strip()
            component_type = str(entry.get("component_type", "")).strip()
            if component_type not in valid_task_scopes.get(task_type, set()):
                invalid_task_scope_pairs.append(
                    {
                        "task_type": task_type,
                        "component_type": component_type,
                    }
                )
                continue
            prepared.append(
                TaskCreditRow(
                    task_type=task_type,
                    component_type=component_type,
                    credit_role=str(entry.get("credit_role", "") or "").strip(),
                    contributor_username=str(entry.get("contributor_username", "") or "").strip(),
                    notes=str(entry.get("notes", "") or "").strip(),
                    updated_by=request.user,
                )
            )

        if invalid_task_scope_pairs:
            return Response(
                {
                    "error": "component_type is not valid for the selected task_type",
                    "invalid_pairs": invalid_task_scope_pairs,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        TaskCreditRow.objects.all().delete()
        if prepared:
            TaskCreditRow.objects.bulk_create(prepared)
        updated = len(prepared)

        record_audit(
            action="credits_updated",
            resource_type="credits",
            resource_id="task-credit-rows",
            actor=request.user.username,
            metadata={"updated_count": updated},
        )

        return Response({"ok": True, "updated_count": updated}, status=status.HTTP_200_OK)


def _nth_permutation(items: list, index: int) -> list:
    pool = list(items)
    n = len(pool)
    if n <= 1:
        return pool

    max_index = math.factorial(n)
    if max_index <= 0:
        return pool

    idx = int(index) % max_index
    out = []
    for i in range(n, 0, -1):
        f = math.factorial(i - 1)
        pick = idx // f
        idx = idx % f
        out.append(pool.pop(pick))
    return out


def _counterbalanced_config_order(config_versions: list, seed: str | None) -> tuple[list, int, int]:
    versions = list(config_versions)
    n = len(versions)
    if n <= 1:
        return versions, 0, 1

    permutations_total = math.factorial(n)
    seed_text = (seed or "").strip()
    if not seed_text:
        seed_text = uuid4().hex

    digest = hashlib.sha256(seed_text.encode("utf-8")).hexdigest()
    permutation_index = int(digest, 16) % permutations_total
    ordered = _nth_permutation(versions, permutation_index)
    return ordered, permutation_index, permutations_total


def _ordered_config_versions_by_ids(config_versions: list, ordered_ids: list[str] | None) -> list:
    versions = list(config_versions)
    if not ordered_ids:
        return versions

    rank = {}
    seq = 0
    for raw in ordered_ids:
        sid = str(raw or "").strip()
        if not sid or sid in rank:
            continue
        rank[sid] = seq
        seq += 1

    if not rank:
        return versions

    present = []
    rest = []
    for v in versions:
        sid = str(v.id)
        if sid in rank:
            present.append(v)
        else:
            rest.append(v)

    present.sort(key=lambda v: rank.get(str(v.id), 10**9))
    return present + rest


def _issue_email_verification_token(user: User) -> str:
    payload = {
        "uid": user.id,
        "email": (user.email or "").strip().lower(),
    }
    return signing.dumps(payload, salt="auth-register-verify-v1", compress=True)


def _read_email_verification_token(token: str) -> dict:
    max_age_hours = int(os.getenv("AUTH_EMAIL_VERIFY_MAX_AGE_HOURS", "72"))
    max_age_seconds = max(1, max_age_hours) * 60 * 60
    return signing.loads(token, salt="auth-register-verify-v1", max_age=max_age_seconds)


def _issue_password_reset_token(user: User) -> str:
    payload = {
        "uid": user.id,
        "email": (user.email or "").strip().lower(),
        "pwd": user.password,
    }
    return signing.dumps(payload, salt="auth-password-reset-v1", compress=True)


def _read_password_reset_token(token: str) -> dict:
    max_age_hours = int(os.getenv("AUTH_PASSWORD_RESET_MAX_AGE_HOURS", "2"))
    max_age_seconds = max(1, max_age_hours) * 60 * 60
    return signing.loads(token, salt="auth-password-reset-v1", max_age=max_age_seconds)


def _portal_auth_redirect(request, msg: str, mode: str = "login") -> HttpResponseRedirect:
    portal_url = os.getenv("COGFLOW_PLATFORM_URL", "").strip() or request.build_absolute_uri("/portal/")
    normalized = portal_url.rstrip("/")
    if normalized.endswith("/portal"):
        base = normalized + "/"
    else:
        base = normalized + "/portal/"
    query = urlencode({"auth_mode": mode, "auth_msg": msg})
    return HttpResponseRedirect(f"{base}?{query}")


def _send_transactional_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    reply_to: str | None = None,
) -> str | None:
    """Send a low-complexity transactional email, preferring Resend API when configured."""

    recipient = (to_email or "").strip()
    if not recipient:
        return None

    from_email = (
        os.getenv("AUTH_FROM_EMAIL", "").strip()
        or os.getenv("DEFAULT_FROM_EMAIL", "").strip()
        or "noreply@localhost"
    )
    resend_api_key = os.getenv("RESEND_API_KEY", "").strip()

    if resend_api_key:
        payload = {
            "from": from_email,
            "to": [recipient],
            "subject": subject,
            "text": text_body,
        }
        if html_body:
            payload["html"] = html_body
        if reply_to and "@" in reply_to:
            payload["reply_to"] = reply_to

        req = Request(
            "https://api.resend.com/emails",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {resend_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=10) as resp:
                if 200 <= getattr(resp, "status", 0) < 300:
                    return "resend"
        except (HTTPError, URLError, TimeoutError, ValueError):
            pass

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=from_email,
        to=[recipient],
        reply_to=[reply_to] if reply_to and "@" in reply_to else None,
    )
    if html_body:
        msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)
    return "smtp"


class AuthLoginView(APIView):
    """Session login endpoint for portal user flows."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_login"

    @transaction.atomic
    def post(self, request):
        serializer = AuthLoginRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = authenticate(request, username=data["username"], password=data["password"])
        if not user:
            record_audit(
                action="auth_login_failed",
                resource_type="user",
                resource_id="unknown",
                actor=(data.get("username") or "unknown").strip() or "unknown",
                metadata={"reason": "invalid_credentials_or_inactive"},
            )
            return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

        login(request, user)
        # Require fresh MFA verification for sensitive actions after each login.
        request.session.pop("mfa_verified_at", None)
        profile = get_or_create_profile(user)

        record_audit(
            action="auth_login",
            resource_type="user",
            resource_id=user.id,
            actor=user.username,
            metadata={"mfa_enabled": profile.mfa_enabled},
        )

        return Response(
            {
                "ok": True,
                "username": user.username,
                "mfa_enabled": profile.mfa_enabled,
            },
            status=status.HTTP_200_OK,
        )


@method_decorator(ensure_csrf_cookie, name="dispatch")
class AuthCsrfView(APIView):
    """Set CSRF cookie for anonymous portal users before auth POSTs."""

    schema = None

    def get(self, request):
        return Response({"ok": True}, status=status.HTTP_200_OK)


class AuthRegisterView(APIView):
    """Self-service registration endpoint (account activates by email verification)."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_register"

    @transaction.atomic
    def post(self, request):
        if request.user.is_authenticated:
            return Response({"error": "Already authenticated"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = AuthRegisterRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        username = data["username"].strip()
        email = data["email"].strip().lower()
        password = data["password"]

        if not username:
            return Response({"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(password) < 8:
            return Response({"error": "Password must be at least 8 characters"}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already exists"}, status=status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email__iexact=email).exists():
            return Response({"error": "Email is already in use"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(username=username, email=email, password=password)
        user.is_active = False
        user.save(update_fields=["is_active"])

        profile = get_or_create_profile(user)
        profile.role = profile.ROLE_RESEARCHER
        profile.save(update_fields=["role"])

        record_audit(
            action="auth_register_requested",
            resource_type="user",
            resource_id=user.id,
            actor=username,
            metadata={"email": email, "default_role": profile.role},
        )

        # Registration mail should not block account creation if SMTP is temporarily unavailable.
        platform_base = (os.getenv("COGFLOW_PLATFORM_URL", "").strip() or request.build_absolute_uri("/")).rstrip("/")
        portal_url = f"{platform_base}/portal/"
        verify_token = _issue_email_verification_token(user)
        verify_url = f"{platform_base}/api/v1/auth/register/verify?{urlencode({'token': verify_token})}"
        try:
                subject = "Verify your CogFlow email"
                text_body = (
                        "Your CogFlow account has been created.\n\n"
                        "Please verify your email to activate sign-in:\n"
                        f"{verify_url}\n\n"
                        f"Portal URL: {portal_url}\n"
                        "If you did not request this account, you can ignore this email."
                )
                html_body = f"""
                <html>
                    <body style=\"margin:0;padding:24px;background:#f7f8fb;font-family:Arial,sans-serif;color:#1f2937;\">
                        <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;\">
                            <h2 style=\"margin:0 0 12px;font-size:20px;color:#30334a;\">Verify your CogFlow email</h2>
                            <p style=\"margin:0 0 12px;line-height:1.6;\">Your CogFlow account has been created.</p>
                            <p style=\"margin:0 0 16px;line-height:1.6;\">Please verify your email to activate sign-in.</p>
                            <p style=\"margin:0 0 20px;\"><a href=\"{verify_url}\" style=\"display:inline-block;background:#30334a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;\">Verify Email</a></p>
                            <p style=\"margin:0 0 10px;line-height:1.6;word-break:break-all;\"><a href=\"{verify_url}\" style=\"color:#30334a;\">{verify_url}</a></p>
                            <p style=\"margin:0;color:#6b7280;line-height:1.6;\">If you did not request this account, you can ignore this email.</p>
                        </div>
                    </body>
                </html>
                """

                _send_transactional_email(
                        to_email=email,
                        subject=subject,
                        text_body=text_body,
                        html_body=html_body,
                )
        except Exception:
            pass

        return Response(
            {
                "ok": True,
                "pending_verification": True,
                "message": "Registration submitted. Check your email for a verification link.",
            },
            status=status.HTTP_201_CREATED,
        )


class AuthRegisterVerifyView(APIView):
    """Activate a newly-registered account via signed email verification token."""

    schema = None

    @transaction.atomic
    def get(self, request):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            return _portal_auth_redirect(request, "Verification link is missing or invalid.", mode="login")

        try:
            data = _read_email_verification_token(token)
        except signing.SignatureExpired:
            return _portal_auth_redirect(request, "Verification link expired. Register again to get a new email.", mode="register")
        except signing.BadSignature:
            return _portal_auth_redirect(request, "Verification link is invalid.", mode="login")

        uid = data.get("uid")
        email = (data.get("email") or "").strip().lower()
        user = User.objects.filter(id=uid).first()
        if not user:
            return _portal_auth_redirect(request, "Account not found for this verification link.", mode="register")

        if (user.email or "").strip().lower() != email:
            return _portal_auth_redirect(request, "Verification link does not match this account.", mode="register")

        if not user.is_active:
            user.is_active = True
            user.save(update_fields=["is_active"])
            record_audit(
                action="auth_register_verified",
                resource_type="user",
                resource_id=user.id,
                actor=user.username,
                metadata={"email": user.email},
            )

        return _portal_auth_redirect(request, "Email verified. You can now sign in.", mode="login")


class AuthLogoutView(APIView):
    @transaction.atomic
    def post(self, request):
        if request.user.is_authenticated:
            record_audit(
                action="auth_logout",
                resource_type="user",
                resource_id=request.user.id,
                actor=request.user.username,
            )
        logout(request)
        return Response({"ok": True}, status=status.HTTP_200_OK)


class TotpSetupView(APIView):
    """Generate or return TOTP setup material for the logged-in user."""

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TotpSetupRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        profile = get_or_create_profile(request.user)
        regenerate = data.get("regenerate", False)

        secret = None
        if profile.mfa_totp_secret_encrypted and not regenerate:
            secret = decrypt_payload(profile.mfa_totp_secret_encrypted)
        else:
            secret = pyotp.random_base32()
            profile.mfa_totp_secret_encrypted = encrypt_payload(secret)
            profile.mfa_enabled = False
            profile.mfa_last_verified_at = None
            profile.save(update_fields=["mfa_totp_secret_encrypted", "mfa_enabled", "mfa_last_verified_at"])
            request.session.pop("mfa_verified_at", None)
            request.session.modified = True

        issuer = os.getenv("MFA_TOTP_ISSUER", "CogFlow Platform")
        otpauth_uri = pyotp.TOTP(secret).provisioning_uri(name=request.user.username, issuer_name=issuer)

        record_audit(
            action="mfa_totp_setup",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
            metadata={"regenerate": regenerate},
        )

        return Response(
            {
                "ok": True,
                "username": request.user.username,
                "totp_secret": secret,
                "otpauth_uri": otpauth_uri,
            },
            status=status.HTTP_200_OK,
        )


class TotpVerifyView(APIView):
    """Verify a TOTP code and mark MFA as active for this session."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth_mfa_verify"

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = TotpVerifyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        code = serializer.validated_data["code"].strip()

        profile = get_or_create_profile(request.user)
        if not profile.mfa_totp_secret_encrypted:
            return Response({"error": "TOTP not set up"}, status=status.HTTP_400_BAD_REQUEST)

        secret = decrypt_payload(profile.mfa_totp_secret_encrypted)
        totp = pyotp.TOTP(secret)
        if not totp.verify(code, valid_window=1):
            record_audit(
                action="mfa_totp_verify_failed",
                resource_type="user",
                resource_id=request.user.id,
                actor=request.user.username,
            )
            return Response({"error": "Invalid TOTP code"}, status=status.HTTP_401_UNAUTHORIZED)

        profile.mfa_enabled = True
        profile.mfa_last_verified_at = timezone.now()
        profile.save(update_fields=["mfa_enabled", "mfa_last_verified_at"])
        stamp = _mark_mfa_verified(request)

        record_audit(
            action="mfa_totp_verify",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
        )

        return Response(
            {
                "ok": True,
                "username": request.user.username,
                "mfa_enabled": profile.mfa_enabled,
                "mfa_verified_at": stamp,
            },
            status=status.HTTP_200_OK,
        )


class TotpDisableView(APIView):
    """Remove TOTP MFA from the logged-in user's account."""

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        profile = get_or_create_profile(request.user)
        profile.mfa_enabled = False
        profile.mfa_totp_secret_encrypted = None
        profile.mfa_last_verified_at = None
        profile.save(update_fields=["mfa_enabled", "mfa_totp_secret_encrypted", "mfa_last_verified_at"])
        request.session.pop("mfa_verified_at", None)
        request.session.modified = True
        record_audit(
            action="mfa_totp_disabled",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)


class PasswordChangeView(APIView):
    """Allow a logged-in user to change their own password."""

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        current = request.data.get("current_password", "")
        new_pwd = request.data.get("new_password", "")
        if not current or not new_pwd:
            return Response({"error": "current_password and new_password are required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(new_pwd) < 8:
            return Response({"error": "New password must be at least 8 characters"}, status=status.HTTP_400_BAD_REQUEST)
        user = authenticate(request, username=request.user.username, password=current)
        if user is None:
            return Response({"error": "Current password is incorrect"}, status=status.HTTP_401_UNAUTHORIZED)
        user.set_password(new_pwd)
        user.save(update_fields=["password"])
        # Maintain the current session so the user stays logged in
        from django.contrib.auth import update_session_auth_hash
        update_session_auth_hash(request, user)
        record_audit(
            action="password_changed",
            resource_type="user",
            resource_id=request.user.id,
            actor=request.user.username,
        )
        return Response({"ok": True}, status=status.HTTP_200_OK)


class PasswordResetRequestView(APIView):
    """Send a password reset email without exposing whether the account exists."""

    @transaction.atomic
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        identity = (serializer.validated_data.get("identity") or "").strip()
        if not identity:
            return Response({"error": "identity is required"}, status=status.HTTP_400_BAD_REQUEST)

        user = (
            User.objects.filter(Q(username__iexact=identity) | Q(email__iexact=identity))
            .order_by("id")
            .first()
        )

        if user and user.is_active and (user.email or "").strip():
            reset_token = _issue_password_reset_token(user)
            platform_base = (os.getenv("COGFLOW_PLATFORM_URL", "").strip() or request.build_absolute_uri("/")).rstrip("/")
            portal_url = f"{platform_base}/portal/"
            reset_url = f"{portal_url}?{urlencode({'auth_mode': 'reset', 'token': reset_token})}"
            try:
                subject = "Reset your CogFlow password"
                text_body = (
                    "A password reset was requested for your CogFlow account.\n\n"
                    "Use the link below to set a new password:\n"
                    f"{reset_url}\n\n"
                    f"Portal URL: {portal_url}\n"
                    "If you did not request this change, you can ignore this email."
                )
                html_body = f"""
                <html>
                    <body style=\"margin:0;padding:24px;background:#f7f8fb;font-family:Arial,sans-serif;color:#1f2937;\">
                        <div style=\"max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;\">
                            <h2 style=\"margin:0 0 12px;font-size:20px;color:#30334a;\">Reset your CogFlow password</h2>
                            <p style=\"margin:0 0 12px;line-height:1.6;\">A password reset was requested for your CogFlow account.</p>
                            <p style=\"margin:0 0 16px;line-height:1.6;\">Use the link below to set a new password.</p>
                            <p style=\"margin:0 0 20px;\"><a href=\"{reset_url}\" style=\"display:inline-block;background:#30334a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;\">Reset Password</a></p>
                            <p style=\"margin:0 0 10px;line-height:1.6;word-break:break-all;\"><a href=\"{reset_url}\" style=\"color:#30334a;\">{reset_url}</a></p>
                            <p style=\"margin:0;color:#6b7280;line-height:1.6;\">If you did not request this change, you can ignore this email.</p>
                        </div>
                    </body>
                </html>
                """

                _send_transactional_email(
                    to_email=(user.email or "").strip(),
                    subject=subject,
                    text_body=text_body,
                    html_body=html_body,
                )
            except Exception:
                pass

        record_audit(
            action="auth_password_reset_requested",
            resource_type="user",
            resource_id=user.id if user else "unknown",
            actor=(user.username if user else identity),
            metadata={"email_present": bool(user and (user.email or "").strip())},
        )

        return Response(
            {"ok": True, "message": "If that account exists and has an email address, a password reset link has been sent."},
            status=status.HTTP_200_OK,
        )


class PasswordResetConfirmView(APIView):
    """Set a new password from a signed email reset token."""

    @transaction.atomic
    def post(self, request):
        serializer = PasswordResetConfirmRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        token = (data.get("token") or "").strip()
        new_pwd = data.get("new_password") or ""
        if len(new_pwd) < 8:
            return Response({"error": "Password must be at least 8 characters"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            token_data = _read_password_reset_token(token)
        except signing.SignatureExpired:
            return Response({"error": "Password reset link expired"}, status=status.HTTP_400_BAD_REQUEST)
        except signing.BadSignature:
            return Response({"error": "Password reset link is invalid"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(id=token_data.get("uid")).first()
        email = (token_data.get("email") or "").strip().lower()
        password_hash = token_data.get("pwd") or ""

        if not user:
            return Response({"error": "Account not found for this reset link"}, status=status.HTTP_400_BAD_REQUEST)
        if not user.is_active:
            return Response({"error": "Account is not active"}, status=status.HTTP_400_BAD_REQUEST)
        if (user.email or "").strip().lower() != email:
            return Response({"error": "Reset link does not match this account"}, status=status.HTTP_400_BAD_REQUEST)
        if user.password != password_hash:
            return Response({"error": "Password reset link is no longer valid"}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_pwd)
        user.save(update_fields=["password"])

        record_audit(
            action="auth_password_reset_completed",
            resource_type="user",
            resource_id=user.id,
            actor=user.username,
        )

        return Response({"ok": True, "message": "Password reset. You can now sign in."}, status=status.HTTP_200_OK)


class AuthMeView(APIView):
    """Return current session user info, or 401 if not authenticated."""

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"authenticated": False}, status=status.HTTP_401_UNAUTHORIZED)
        profile = get_or_create_profile(request.user)
        mfa_verified_at = request.session.get("mfa_verified_at")
        return Response(
            {
                "authenticated": True,
                "username": request.user.username,
                "email": request.user.email or "",
                "role": profile.role,
                "mfa_enabled": profile.mfa_enabled,
                "mfa_verified_at": mfa_verified_at,
            },
            status=status.HTTP_200_OK,
        )


class FeedbackSubmitView(APIView):
    """Submit in-portal feedback (Resend preferred, SMTP fallback)."""

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback_submit"

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        serializer = FeedbackSubmitRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        category = (data.get("category") or "other").strip().lower() or "other"
        subject = (data.get("subject") or "").strip()
        message = (data.get("message") or "").strip()
        contact_email = (data.get("contact_email") or "").strip()

        if not message:
            return Response({"error": "Message is required"}, status=status.HTTP_400_BAD_REQUEST)

        username = request.user.username
        user_email = (request.user.email or "").strip()
        effective_contact = contact_email or user_email or "(not provided)"
        subject_line = subject or f"CogFlow Portal Feedback ({category})"

        portal_url = os.getenv("COGFLOW_PLATFORM_URL", "").strip()
        metadata_lines = [
            f"User: {username}",
            f"User email: {user_email or '(none)'}",
            f"Contact email: {effective_contact}",
            f"Category: {category}",
            f"Portal URL: {portal_url or '(not set)'}",
            f"Timestamp (UTC): {timezone.now().isoformat()}",
        ]
        text_body = (
            "CogFlow Portal feedback submission\n\n"
            + "\n".join(metadata_lines)
            + "\n\nMessage\n-------\n"
            + message
            + "\n"
        )

        to_email = (
            os.getenv("FEEDBACK_TO_EMAIL", "").strip()
            or os.getenv("DEFAULT_FROM_EMAIL", "").strip()
            or "noreply@localhost"
        )
        from_email = (
            os.getenv("FEEDBACK_FROM_EMAIL", "").strip()
            or os.getenv("DEFAULT_FROM_EMAIL", "").strip()
            or "noreply@localhost"
        )

        delivered_via = None
        resend_api_key = os.getenv("RESEND_API_KEY", "").strip()
        if resend_api_key:
            payload = {
                "from": from_email,
                "to": [to_email],
                "subject": subject_line,
                "text": text_body,
                "reply_to": effective_contact if "@" in effective_contact else None,
            }
            if payload.get("reply_to") is None:
                payload.pop("reply_to", None)

            req = Request(
                "https://api.resend.com/emails",
                data=json.dumps(payload).encode("utf-8"),
                headers={
                    "Authorization": f"Bearer {resend_api_key}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            try:
                with urlopen(req, timeout=10) as resp:
                    if 200 <= getattr(resp, "status", 0) < 300:
                        delivered_via = "resend"
            except (HTTPError, URLError, TimeoutError, ValueError):
                delivered_via = None

        if not delivered_via:
            msg = EmailMultiAlternatives(
                subject=subject_line,
                body=text_body,
                from_email=from_email,
                to=[to_email],
                reply_to=[effective_contact] if "@" in effective_contact else None,
            )
            msg.send(fail_silently=False)
            delivered_via = "smtp"

        record_audit(
            action="feedback_submitted",
            resource_type="user",
            resource_id=request.user.id,
            actor=username,
            metadata={
                "category": category,
                "delivery": delivered_via,
                "contact_email": effective_contact,
                "subject_present": bool(subject),
            },
        )

        return Response({"ok": True, "delivery": delivered_via}, status=status.HTTP_200_OK)


class AdminUsersView(APIView):
    """List and create platform users (platform_admin only)."""

    @transaction.atomic
    def get(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        users = []
        for user in User.objects.all().order_by("username"):
            profile = get_or_create_profile(user)
            users.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "is_active": user.is_active,
                    "is_superuser": user.is_superuser,
                    "role": profile.role,
                    "mfa_enabled": profile.mfa_enabled,
                    "last_login": user.last_login,
                    "date_joined": user.date_joined,
                }
            )

        return Response({"users": users}, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminCreateUserRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        username = data["username"].strip()
        if User.objects.filter(username=username).exists():
            return Response({"error": "Username already exists"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(
            username=username,
            password=data["password"],
            email=(data.get("email") or "").strip(),
        )
        user.is_active = data.get("is_active", True)
        user.save(update_fields=["is_active"])

        profile = get_or_create_profile(user)
        profile.role = data["role"]
        profile.save(update_fields=["role"])

        record_audit(
            action="admin_user_created",
            resource_type="user",
            resource_id=user.id,
            actor=request.user.username,
            metadata={"username": user.username, "role": profile.role},
        )

        return Response(
            {
                "ok": True,
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "is_active": user.is_active,
                    "role": profile.role,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class AdminUserRoleView(APIView):
    """Update an existing user's role (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminUpdateUserRoleRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data["role"]

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        profile = get_or_create_profile(target)
        profile.role = role
        profile.save(update_fields=["role"])

        record_audit(
            action="admin_user_role_updated",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username, "role": role},
        )

        return Response(
            {"ok": True, "user": {"id": target.id, "username": target.username, "role": profile.role}},
            status=status.HTTP_200_OK,
        )


class AdminUserDeleteView(APIView):
    """Delete a user account (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        if request.user.id == user_id:
            return Response({"error": "You cannot delete your own account"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        username = target.username
        target.delete()

        record_audit(
            action="admin_user_deleted",
            resource_type="user",
            resource_id=user_id,
            actor=request.user.username,
            metadata={"username": username},
        )

        return Response({"ok": True}, status=status.HTTP_200_OK)


class AdminUserActivationView(APIView):
    """Activate or deactivate a user account (platform_admin only)."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminUpdateUserActivationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_active = serializer.validated_data["is_active"]

        if request.user.id == user_id and not is_active:
            return Response({"error": "You cannot deactivate your own account"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        target.is_active = is_active
        target.save(update_fields=["is_active"])

        record_audit(
            action="admin_user_activation_updated",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username, "is_active": is_active},
        )

        return Response(
            {
                "ok": True,
                "user": {
                    "id": target.id,
                    "username": target.username,
                    "is_active": target.is_active,
                },
            },
            status=status.HTTP_200_OK,
        )


class AdminUserPasswordView(APIView):
    """Allow platform admins to set a new temporary password for any user."""

    @transaction.atomic
    def post(self, request, user_id: int):
        _, error = _require_platform_admin(request)
        if error:
            return error

        serializer = AdminSetUserPasswordRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_password = serializer.validated_data["new_password"]

        if len(new_password) < 8:
            return Response({"error": "Password must be at least 8 characters"}, status=status.HTTP_400_BAD_REQUEST)

        target = User.objects.filter(id=user_id).first()
        if not target:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        target.set_password(new_password)
        target.save(update_fields=["password"])

        record_audit(
            action="admin_user_password_reset",
            resource_type="user",
            resource_id=target.id,
            actor=request.user.username,
            metadata={"username": target.username},
        )

        return Response(
            {"ok": True, "user": {"id": target.id, "username": target.username}},
            status=status.HTTP_200_OK,
        )


class BuilderAppView(APIView):
    """Serve the CogFlow Builder frontend with this platform's URL pre-configured."""

    schema = None

    def get(self, request):
        from django.conf import settings
        from django.http import HttpResponse

        builder_dir = settings.BASE_DIR / "frontend" / "builder"
        if not builder_dir.exists():
            builder_dir = settings.BASE_DIR.parent / "frontend" / "builder"

        index_path = builder_dir / "index.html"
        if not index_path.exists():
            return Response(
                {"error": "Builder not available — frontend assets not mounted."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        platform_url = request.build_absolute_uri("/").rstrip("/")
        username = request.user.username if request.user.is_authenticated else ""
        role = ""
        if request.user.is_authenticated:
            try:
                role = get_or_create_profile(request.user).role
            except Exception:
                role = ""

        html = index_path.read_text(encoding="utf-8")
        html = html.replace(
            "window.COGFLOW_PLATFORM_URL    = '';",
            "\n".join([
                f"window.COGFLOW_PLATFORM_URL    = {json.dumps(platform_url)};",
                f"window.COGFLOW_RESEARCHER_USERNAME = {json.dumps(username)};",
                f"window.COGFLOW_RESEARCHER_ROLE = {json.dumps(role)};",
            ]),
        )

        # Runtime cache buster for local Builder scripts so browser cache never pins old JS.
        try:
            json_builder_js = builder_dir / "src" / "JsonBuilder.js"
            timeline_builder_js = builder_dir / "src" / "modules" / "TimelineBuilder.js"
            mtimes = []
            for p in (json_builder_js, timeline_builder_js, index_path):
                if p.exists():
                    mtimes.append(int(p.stat().st_mtime))
            cache_bust = str(max(mtimes)) if mtimes else str(int(timezone.now().timestamp()))

            html = re.sub(
                r'(src="src/[^"]+\.js)(\?v=[^"]*)?(")',
                rf'\1?v={cache_bust}\3',
                html,
                flags=re.IGNORECASE,
            )
        except Exception:
            # If cache-buster generation fails, continue serving Builder as usual.
            pass

        response = HttpResponse(html, content_type="text/html; charset=utf-8")
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        response["Expires"] = "0"
        return response


class InterpreterAppView(APIView):
    """Serve the CogFlow Interpreter frontend with this platform's URL pre-configured."""

    schema = None

    def get(self, request):
        from django.conf import settings
        from django.http import HttpResponse

        interpreter_dir = settings.BASE_DIR / "frontend" / "interpreter"
        if not interpreter_dir.exists():
            interpreter_dir = settings.BASE_DIR.parent / "frontend" / "interpreter"

        index_path = interpreter_dir / "index.html"
        if not index_path.exists():
            return Response(
                {"error": "Interpreter not available — frontend assets not mounted."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        platform_url = request.build_absolute_uri("/").rstrip("/")
        html = index_path.read_text(encoding="utf-8")
        html = html.replace(
            "window.COGFLOW_PLATFORM_URL = '';",
            f"window.COGFLOW_PLATFORM_URL = '{platform_url}';",
        )

        # Runtime cache buster for local Interpreter scripts so browser cache never pins old JS.
        try:
            main_js = interpreter_dir / "src" / "main.js"
            timeline_compiler_js = interpreter_dir / "src" / "timelineCompiler.js"
            mtimes = []
            for p in (main_js, timeline_compiler_js, index_path):
                if p.exists():
                    mtimes.append(int(p.stat().st_mtime))
            cache_bust = str(max(mtimes)) if mtimes else str(int(timezone.now().timestamp()))

            html = re.sub(
                r'(src="src/[^"]+\.js)(\?v=[^"]*)?(")',
                rf'\1?v={cache_bust}\3',
                html,
                flags=re.IGNORECASE,
            )
        except Exception:
            # If cache-buster generation fails, continue serving Interpreter as usual.
            pass

        response = HttpResponse(html, content_type="text/html; charset=utf-8")
        response["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response["Pragma"] = "no-cache"
        response["Expires"] = "0"
        return response


@method_decorator(ensure_csrf_cookie, name="dispatch")
class PortalDashboardView(APIView):
    """Serve the portal dashboard draft as a Django template."""

    schema = None

    def get(self, request):
        db_admin_url = (os.getenv("COGFLOW_DB_ADMIN_URL", "") or "").strip()
        if not db_admin_url:
            host = request.get_host().split(":", 1)[0]
            adminer_port = (os.getenv("ADMINER_HOST_PORT", "8080") or "8080").strip() or "8080"
            db_admin_url = (
                f"{request.scheme}://{host}:{adminer_port}/"
                "?pgsql=db&username=cogflow&db=cogflow_platform&ns=public"
            )
        return render(request, "portal/index.html", {"db_admin_url": db_admin_url})


class StudiesListView(APIView):
    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        studies_qs = Study.objects.filter(is_active=True)
        studies_qs = studies_qs.filter(
            Q(owner_user=request.user) | Q(researcher_access__user=request.user)
        ).distinct()

        studies_qs = studies_qs.annotate(
            run_count_agg=Count("run_sessions", distinct=True),
            last_result_at_agg=Max("run_sessions__result_envelope__created_at"),
        )
        studies = []
        for study in studies_qs[:100]:
            last_config = study.config_versions.first()
            studies.append(
                {
                    "study_slug": study.slug,
                    "study_name": study.name,
                    "runtime_mode": study.runtime_mode,
                    "owner_username": _get_study_owner_username(study),
                    "owner_usernames": _get_study_owner_usernames(study),
                    "latest_config_version": last_config.version_label if last_config else None,
                    "dashboard_url": f"/portal/studies/{study.slug}",
                    "run_count": study.run_count_agg,
                    "last_result_at": study.last_result_at_agg,
                    "last_activity_at": study.last_result_at_agg or study.updated_at,
                }
            )
        return Response({"studies": studies})


class StudyRunsView(APIView):
    """Return recent run metadata for a study to power dashboard result access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        runs = []
        for run in study.run_sessions.select_related("owner_user", "result_envelope", "config_version").order_by("-started_at")[:20]:
            envelope = getattr(run, "result_envelope", None)
            cfg = getattr(run, "config_version", None)
            cfg_json = cfg.config_json if cfg and isinstance(cfg.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            runs.append(
                {
                    "run_session_id": run.id,
                    "status": run.status,
                    "started_at": run.started_at,
                    "completed_at": run.completed_at,
                    "owner_username": run.owner_user.username if run.owner_user else _get_study_owner_username(study),
                    "participant_key_preview": f"{run.participant_key[:12]}..." if run.participant_key else None,
                    "task_type": task_type,
                    "config_version_id": cfg.id if cfg else None,
                    "config_version_label": cfg.version_label if cfg else None,
                    "has_result": bool(envelope),
                    "trial_count": envelope.trial_count if envelope else 0,
                    "result_created_at": envelope.created_at if envelope else None,
                }
            )

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "runs": runs,
            },
            status=status.HTTP_200_OK,
        )


class StudyLatestConfigView(APIView):
    """Return the latest published config JSON for a study the researcher can access."""

    def get(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        versions = list(study.config_versions.all())
        config_version = versions[0] if versions else None
        if not config_version:
            return Response({"error": "No published config version"}, status=status.HTTP_404_NOT_FOUND)

        configs = []
        available_task_types = []
        for v in versions:
            cfg_json = v.config_json if isinstance(v.config_json, dict) else {}
            task_type = (cfg_json.get("task_type") or cfg_json.get("taskType") or "")
            task_type = str(task_type).strip().lower() or None
            if task_type and task_type not in available_task_types:
                available_task_types.append(task_type)
            configs.append(
                {
                    "config_version_id": v.id,
                    "config_version_label": v.version_label,
                    "task_type": task_type,
                    "config": v.config_json,
                }
            )

        latest_task_type = (config_version.config_json.get("task_type") or config_version.config_json.get("taskType") or "") if isinstance(config_version.config_json, dict) else ""
        latest_task_type = str(latest_task_type).strip().lower() or None

        return Response(
            {
                "study_slug": study.slug,
                "study_name": study.name,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "task_type": latest_task_type,
                "available_task_types": available_task_types,
                "configs": configs,
                "config": config_version.config_json,
            },
            status=status.HTTP_200_OK,
        )


class PublishConfigView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = PublishConfigRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)
        profile = None
        if request.user.is_authenticated:
            profile = get_or_create_profile(request.user)

        existing_study = Study.objects.filter(slug=data["study_slug"]).first()
        if existing_study and request.user.is_authenticated and _can_manage_researcher_resources(request, profile):
            if existing_study.owner_user_id and not _has_study_access(existing_study, request.user, profile):
                return Response(
                    {"error": "Study is not shared with the current researcher"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        if existing_study:
            study = existing_study
            study.name = data["study_name"]
            study.runtime_mode = data["runtime_mode"]
            study.save(update_fields=["name", "runtime_mode"])
        else:
            study = Study.objects.create(
                slug=data["study_slug"],
                name=data["study_name"],
                runtime_mode=data["runtime_mode"],
            )

        if request.user.is_authenticated:
            if _can_manage_researcher_resources(request, profile):
                if study.owner_user_id and not _has_study_access(study, request.user, profile):
                    return Response(
                        {"error": "Study is not shared with the current researcher"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if not study.owner_user_id or study.owner_user_id == request.user.id:
                    study.owner_user = request.user
                    study.save(update_fields=["owner_user"])
                elif study.owner_user_id != request.user.id:
                    StudyResearcherAccess.objects.get_or_create(
                        study=study,
                        user=request.user,
                        defaults={"granted_by": request.user},
                    )

        requested_version_label = data["config_version_label"]
        incoming_task_type = _extract_config_task_type(data.get("config"))
        label_adjusted = False

        existing_same_label = ConfigVersion.objects.filter(
            study=study,
            version_label=requested_version_label,
        ).first()

        if not existing_same_label:
            config_version = ConfigVersion.objects.create(
                study=study,
                version_label=requested_version_label,
                builder_version=data.get("builder_version", ""),
                config_json=data["config"],
            )
        else:
            existing_task_type = _extract_config_task_type(existing_same_label.config_json)
            same_task_type = bool(incoming_task_type) and bool(existing_task_type) and (incoming_task_type == existing_task_type)
            same_content = (existing_same_label.config_json == data["config"])

            if same_task_type or same_content:
                existing_same_label.builder_version = data.get("builder_version", "")
                existing_same_label.config_json = data["config"]
                existing_same_label.save(update_fields=["builder_version", "config_json"])
                config_version = existing_same_label
            else:
                suffix = incoming_task_type or "task"
                safe_suffix = re.sub(r"[^a-z0-9_-]", "-", suffix.lower()).strip("-") or "task"
                candidate = f"{requested_version_label}__{safe_suffix}"
                n = 2
                while ConfigVersion.objects.filter(study=study, version_label=candidate).exists():
                    candidate = f"{requested_version_label}__{safe_suffix}-{n}"
                    n += 1

                config_version = ConfigVersion.objects.create(
                    study=study,
                    version_label=candidate,
                    builder_version=data.get("builder_version", ""),
                    config_json=data["config"],
                )
                label_adjusted = True

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="publish_config",
            resource_type="study",
            resource_id=study.id,
            actor=actor,
            metadata={
                "requested_version_label": requested_version_label,
                "version_label": config_version.version_label,
                "version_label_adjusted": label_adjusted,
                "task_type": incoming_task_type,
            },
        )

        return Response(
            {
                "study_id": study.id,
                "config_version_id": config_version.id,
                "config_version_label": config_version.version_label,
                "requested_config_version_label": requested_version_label,
                "config_version_label_adjusted": label_adjusted,
                "study_slug": study.slug,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "dashboard_url": f"/portal/studies/{study.slug}",
            },
            status=status.HTTP_201_CREATED,
        )


class UploadBuilderAssetView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    @transaction.atomic
    def post(self, request):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"error": "Missing file"}, status=status.HTTP_400_BAD_REQUEST)

        max_bytes = int(os.getenv("BUILDER_ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
        if (getattr(uploaded, "size", 0) or 0) > max_bytes:
            return Response({"error": f"File too large (max {max_bytes} bytes)"}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)

        original_name = (uploaded.name or "asset").strip() or "asset"
        ext = os.path.splitext(original_name.lower())[1]
        allowed_exts = {
            ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif",
            ".mp3", ".wav", ".ogg", ".m4a",
            ".mp4", ".webm",
        }
        if ext not in allowed_exts:
            return Response({"error": f"Unsupported asset type: {ext or 'unknown'}"}, status=status.HTTP_400_BAD_REQUEST)

        content_type = (uploaded.content_type or "").strip().lower()
        if content_type and not (
            content_type.startswith("image/")
            or content_type.startswith("audio/")
            or content_type.startswith("video/")
        ):
            return Response({"error": f"Unsupported content type: {content_type}"}, status=status.HTTP_400_BAD_REQUEST)

        study_slug = (request.data.get("study_slug") or "").strip()
        study = None
        scope_slug = "unscoped"

        if study_slug:
            study = Study.objects.filter(slug=study_slug).first()
            if not study:
                return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)
            if not _has_study_access(study, request.user, profile):
                return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)
            scope_slug = study.slug

        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", original_name)
        safe_name = re.sub(r"_+", "_", safe_name).strip("._")
        if not safe_name:
            safe_name = "asset"

        rel_path = default_storage.save(
            f"builder-assets/{scope_slug}/{uuid4().hex[:12]}-{safe_name}",
            uploaded,
        )
        rel_path = rel_path.replace("\\", "/")

        try:
            public_url = request.build_absolute_uri(default_storage.url(rel_path))
        except Exception:
            public_url = request.build_absolute_uri(f"/media/{rel_path}")

        return Response(
            {
                "ok": True,
                "url": public_url,
                "path": rel_path,
                "study_slug": study.slug if study else None,
                "filename": original_name,
            },
            status=status.HTTP_201_CREATED,
        )


class CreateParticipantLinkView(APIView):
    """Generate signed participant launch links for a researcher-owned study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        owner_username = _get_study_owner_username(study)
        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CreateParticipantLinkRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        config_versions = list(study.config_versions.all())
        known_ids = {str(cv.id) for cv in config_versions}

        expires_at = timezone.now() + timedelta(hours=data.get("expires_in_hours", 72))
        participant_external_id = (data.get("participant_external_id") or "").strip()
        counterbalance_enabled = bool(data.get("counterbalance_enabled", True))
        task_order_strict = bool(data.get("task_order_strict", False))
        raw_task_order = data.get("task_order") or []
        task_order = []
        for raw in raw_task_order:
            sid = str(raw or "").strip()
            if not sid or sid not in known_ids or sid in task_order:
                continue
            task_order.append(sid)
        completion_redirect_url = (data.get("completion_redirect_url") or "").strip()
        abort_redirect_url = (data.get("abort_redirect_url") or "").strip()
        prolific_completion_mode = (data.get("prolific_completion_mode") or "default").strip() or "default"
        prolific_completion_code = (data.get("prolific_completion_code") or "").strip()
        base_payload = {
            "study_slug": study.slug,
            "researcher_username": request.user.username,
            "participant_external_id": participant_external_id,
            "counterbalance_enabled": counterbalance_enabled,
            "task_order": task_order,
            "task_order_strict": task_order_strict,
            "expires_at": expires_at.isoformat(),
            "completion_redirect_url": completion_redirect_url,
            "abort_redirect_url": abort_redirect_url,
            "prolific_completion_mode": prolific_completion_mode,
            "prolific_completion_code": prolific_completion_code,
        }
        single_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "single_use",
            }
        )
        multi_use_token = _issue_launch_token(
            {
                **base_payload,
                "launch_mode": "multi_use",
            }
        )

        record_audit(
            action="create_participant_link",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "expires_at": expires_at.isoformat(),
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
                "prolific_completion_mode": prolific_completion_mode,
                "has_prolific_completion_code": bool(prolific_completion_code),
                "counterbalance_enabled": counterbalance_enabled,
                "task_order_count": len(task_order),
                "task_order_strict": task_order_strict,
                "single_use_token_digest": _launch_token_digest(single_use_token),
                "multi_use_token_digest": _launch_token_digest(multi_use_token),
            },
        )

        launch_url_multi = f"/interpreter/index.html?launch={multi_use_token}"
        launch_url_single = f"/interpreter/index.html?launch={single_use_token}"
        return Response(
            {
                "study_slug": study.slug,
                "launch_token": multi_use_token,
                "launch_url": launch_url_multi,
                "counterbalance_enabled": counterbalance_enabled,
                "task_order": task_order,
                "task_order_strict": task_order_strict,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "prolific_completion_mode": prolific_completion_mode,
                "prolific_completion_code": prolific_completion_code,
                "launch_options": {
                    "multi_use": {
                        "launch_mode": "multi_use",
                        "launch_token": multi_use_token,
                        "launch_url": launch_url_multi,
                        "counterbalance_enabled": counterbalance_enabled,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                    "single_use": {
                        "launch_mode": "single_use",
                        "launch_token": single_use_token,
                        "launch_url": launch_url_single,
                        "counterbalance_enabled": counterbalance_enabled,
                        "task_order": task_order,
                        "task_order_strict": task_order_strict,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                        "prolific_completion_mode": prolific_completion_mode,
                        "prolific_completion_code": prolific_completion_code,
                    },
                },
                "expires_at": expires_at,
                "owner_username": owner_username or request.user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_201_CREATED,
        )


class AssignStudyOwnerView(APIView):
    """Allow platform admins to reassign researcher ownership for a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if profile.role != profile.ROLE_ADMIN:
            return Response({"error": "Platform admin role required"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        serializer = AssignStudyOwnerRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["owner_username"].strip()

        new_owner = User.objects.filter(username=target_username).first()
        if not new_owner:
            return Response({"error": "Owner user not found"}, status=status.HTTP_404_NOT_FOUND)

        study.owner_user = new_owner
        study.save(update_fields=["owner_user"])

        record_audit(
            action="assign_study_owner",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "new_owner_username": new_owner.username,
            },
        )

        return Response(
            {
                "study_slug": study.slug,
                "owner_username": new_owner.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class ShareStudyView(APIView):
    """Share a study with another researcher by username."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = ShareStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()
        can_remove_users = serializer.validated_data.get("can_remove_users", False)

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        if not target_user.is_active:
            return Response({"error": "User account is inactive"}, status=status.HTTP_400_BAD_REQUEST)

        target_profile = get_or_create_profile(target_user)
        if target_profile.role not in {target_profile.ROLE_RESEARCHER, target_profile.ROLE_ADMIN}:
            return Response(
                {"error": "Only researcher/admin accounts can be study owners"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        already_owner = study.owner_user_id == target_user.id
        created = False
        permission_updated = False
        if not already_owner:
            access, created = StudyResearcherAccess.objects.get_or_create(
                study=study,
                user=target_user,
                defaults={
                    "granted_by": request.user,
                    "can_remove_users": can_remove_users,
                },
            )
            if not created and access.can_remove_users != can_remove_users:
                access.can_remove_users = can_remove_users
                access.save(update_fields=["can_remove_users"])
                permission_updated = True

        record_audit(
            action="share_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_owner": already_owner,
                "created": created,
                "can_remove_users": bool(can_remove_users),
                "permission_updated": permission_updated,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_shared": already_owner or (not created),
                "can_remove_users": (False if already_owner else bool(can_remove_users)),
                "permission_updated": permission_updated,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class RevokeStudyAccessView(APIView):
    """Remove researcher collaboration access from a study."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        if not _can_remove_study_users(study, request.user, profile):
            return Response({"error": "You do not have permission to remove users for this study"}, status=status.HTTP_403_FORBIDDEN)

        serializer = RevokeStudyAccessRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target_username = serializer.validated_data["username"].strip()

        target_user = User.objects.filter(username=target_username).first()
        if not target_user:
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)

        if study.owner_user_id == target_user.id:
            return Response({"error": "Cannot remove the study owner"}, status=status.HTTP_400_BAD_REQUEST)

        access = StudyResearcherAccess.objects.filter(study=study, user=target_user).first()
        if not access:
            return Response({"error": "User does not currently have collaborator access"}, status=status.HTTP_400_BAD_REQUEST)

        access.delete()

        record_audit(
            action="revoke_study_access",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "revoked_username": target_user.username,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "revoked_username": target_user.username,
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class DuplicateStudyView(APIView):
    """Duplicate a study and clone its latest published config for further editing."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        source_study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not source_study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(source_study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        serializer = DuplicateStudyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        requested_name = (serializer.validated_data.get("study_name") or "").strip()
        requested_slug = (serializer.validated_data.get("study_slug") or "").strip()

        new_study_name = requested_name or f"{source_study.name} (Copy)"
        base_slug = slugify(requested_slug or new_study_name) or slugify(f"{source_study.slug}-copy") or "study-copy"
        if base_slug == source_study.slug:
            base_slug = f"{base_slug}-copy"

        candidate_slug = base_slug
        n = 2
        while Study.objects.filter(slug=candidate_slug).exists():
            candidate_slug = f"{base_slug}-{n}"
            n += 1

        source_config = source_study.config_versions.first()
        if not source_config:
            return Response({"error": "No published config version found to duplicate"}, status=status.HTTP_400_BAD_REQUEST)

        duplicated_study = Study.objects.create(
            slug=candidate_slug,
            name=new_study_name,
            runtime_mode=source_study.runtime_mode,
            owner_user=request.user,
            is_active=True,
        )

        duplicated_config = ConfigVersion.objects.create(
            study=duplicated_study,
            version_label=source_config.version_label,
            builder_version=source_config.builder_version,
            config_json=source_config.config_json,
        )

        record_audit(
            action="duplicate_study",
            resource_type="study",
            resource_id=duplicated_study.id,
            actor=request.user.username,
            metadata={
                "source_study_slug": source_study.slug,
                "duplicated_study_slug": duplicated_study.slug,
                "source_config_version_id": source_config.id,
                "duplicated_config_version_id": duplicated_config.id,
            },
        )

        return Response(
            {
                "ok": True,
                "source_study_slug": source_study.slug,
                "study_slug": duplicated_study.slug,
                "study_name": duplicated_study.name,
                "runtime_mode": duplicated_study.runtime_mode,
                "owner_username": _get_study_owner_username(duplicated_study),
                "owner_usernames": _get_study_owner_usernames(duplicated_study),
                "config_version_id": duplicated_config.id,
                "config_version_label": duplicated_config.version_label,
            },
            status=status.HTTP_201_CREATED,
        )


class DeleteStudyView(APIView):
    """Soft-delete (deactivate) a study while retaining all audit/config/result records."""

    @transaction.atomic
    def post(self, request, study_slug: str):
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        if not _can_manage_researcher_resources(request, profile):
            return Response({"error": "Insufficient role permissions"}, status=status.HTTP_403_FORBIDDEN)

        study = Study.objects.filter(slug=study_slug, is_active=True).first()
        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        if not _has_study_access(study, request.user, profile):
            return Response({"error": "Study is not owned by the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        config_count = study.config_versions.count()
        run_count = study.run_sessions.count()
        result_count = ResultEnvelope.objects.filter(run_session__study=study).count()

        study.is_active = False
        study.updated_at = timezone.now()
        study.save(update_fields=["is_active", "updated_at"])

        record_audit(
            action="delete_study",
            resource_type="study",
            resource_id=study.id,
            actor=request.user.username,
            metadata={
                "study_slug": study.slug,
                "study_name": study.name,
                "config_versions_retained": config_count,
                "run_sessions_retained": run_count,
                "result_envelopes_retained": result_count,
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "study_name": study.name,
                "is_active": study.is_active,
                "retained": {
                    "config_versions": config_count,
                    "run_sessions": run_count,
                    "result_envelopes": result_count,
                },
            },
            status=status.HTTP_200_OK,
        )


class StartRunView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = StartRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        token_payload = {}
        study = None
        owner_username = None
        launch_mode = None
        launch_token_digest = None
        counterbalance_enabled = True
        requested_task_order = []
        task_order_strict = False

        launch_token = data.get("launch_token")
        if launch_token:
            try:
                token_payload = _read_launch_token(launch_token)
            except signing.BadSignature:
                return Response({"error": "Launch token invalid"}, status=status.HTTP_400_BAD_REQUEST)

            exp_text = token_payload.get("expires_at")
            try:
                exp_dt = timezone.datetime.fromisoformat(exp_text)
                if timezone.is_naive(exp_dt):
                    exp_dt = timezone.make_aware(exp_dt)
            except Exception:
                return Response({"error": "Launch token malformed"}, status=status.HTTP_400_BAD_REQUEST)

            if timezone.now() >= exp_dt:
                return Response({"error": "Launch token expired"}, status=status.HTTP_410_GONE)

            study_slug = (token_payload.get("study_slug") or "").strip()
            owner_username = (token_payload.get("researcher_username") or "").strip() or None
            launch_mode = (token_payload.get("launch_mode") or "multi_use").strip()
            launch_token_digest = _launch_token_digest(launch_token)
            counterbalance_enabled = bool(token_payload.get("counterbalance_enabled", True))
            requested_task_order = token_payload.get("task_order") if isinstance(token_payload.get("task_order"), list) else []
            task_order_strict = bool(token_payload.get("task_order_strict", False))

            if launch_mode == "single_use":
                already_used = AuditEvent.objects.filter(
                    action="start_run",
                    resource_type="run_session",
                    metadata_json__launch_token_digest=launch_token_digest,
                ).exists()
                if already_used:
                    return Response({"error": "Single-use launch token already consumed"}, status=status.HTTP_409_CONFLICT)

            study = Study.objects.filter(slug=study_slug, is_active=True).first()
        elif data.get("study_slug"):
            study = Study.objects.filter(slug=data["study_slug"], is_active=True).first()

        if not study:
            return Response({"error": "Study not found"}, status=status.HTTP_404_NOT_FOUND)

        participant_external_id = (
            data.get("participant_external_id")
            or (token_payload.get("participant_external_id") if launch_token else "")
            or "anonymous"
        )
        participant_key = hash_identifier(participant_external_id)

        config_versions = list(study.config_versions.all())
        if not config_versions:
            return Response({"error": "No published config version"}, status=status.HTTP_400_BAD_REQUEST)

        requested_ids = []
        requested_ids_seen = set()
        for raw in requested_task_order:
            sid = str(raw or "").strip()
            if not sid or sid in requested_ids_seen:
                continue
            requested_ids.append(sid)
            requested_ids_seen.add(sid)

        selected_versions = config_versions
        if task_order_strict and requested_ids:
            requested_set = set(requested_ids)
            selected_versions = [cv for cv in config_versions if str(cv.id) in requested_set]
            if not selected_versions:
                return Response(
                    {"error": "Requested task selection does not match any published config versions"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        permutations_total = 1
        permutation_index = 0
        counterbalance_mode = "fixed"

        if counterbalance_enabled:
            ordered_versions, permutation_index, permutations_total = _counterbalanced_config_order(
                selected_versions,
                seed=participant_external_id,
            )
            counterbalance_mode = "permutation_by_participant_strict" if task_order_strict and requested_ids else "permutation_by_participant"
        else:
            ordered_versions = _ordered_config_versions_by_ids(selected_versions, requested_ids)
            if task_order_strict and requested_ids:
                counterbalance_mode = "manual_order_strict"
            else:
                counterbalance_mode = "manual_order" if requested_ids else "fixed"

        config_version = ordered_versions[0]

        configs_payload = []
        available_task_types = []
        for cv in ordered_versions:
            task_type = _extract_config_task_type(cv.config_json)
            if task_type and task_type not in available_task_types:
                available_task_types.append(task_type)
            configs_payload.append(
                {
                    "config_version_id": cv.id,
                    "config_version_label": cv.version_label,
                    "task_type": task_type,
                    "config": cv.config_json,
                }
            )

        owner_user = study.owner_user
        if not owner_user and owner_username:
            owner_user = User.objects.filter(username=owner_username).first()

        owner_name_response = owner_user.username if owner_user else owner_username

        run_session = RunSession.objects.create(
            study=study,
            config_version=config_version,
            owner_user=owner_user,
            participant_key=participant_key,
            status="started",
        )

        completion_redirect_url = _resolve_redirect_url(
            token_payload.get("completion_redirect_url") if launch_token else None,
            participant_external_id,
            participant_key,
            run_session.id,
        )
        abort_redirect_url = _resolve_redirect_url(
            token_payload.get("abort_redirect_url") if launch_token else None,
            participant_external_id,
            participant_key,
            run_session.id,
        )
        prolific_completion_mode = (
            (token_payload.get("prolific_completion_mode") if launch_token else None)
            or "default"
        )
        prolific_completion_code = (
            (token_payload.get("prolific_completion_code") if launch_token else None)
            or ""
        )

        record_audit(
            action="start_run",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "study_slug": study.slug,
                "owner_username": owner_name_response,
                "launch_mode": launch_mode,
                "launch_token_digest": launch_token_digest,
                "config_versions_count": len(config_versions),
                "counterbalance_enabled": counterbalance_enabled,
                "counterbalance_mode": counterbalance_mode,
                "counterbalance_permutation_index": permutation_index,
                "counterbalance_permutations_total": permutations_total,
                "task_order_strict": task_order_strict,
                "task_order_count": len(requested_ids),
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
                "prolific_completion_mode": prolific_completion_mode,
                "has_prolific_completion_code": bool(prolific_completion_code),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": study.slug,
                "config_version_id": config_version.id,
                "config": config_version.config_json,
                "configs": configs_payload,
                "available_task_types": available_task_types,
                "counterbalance": {
                    "mode": counterbalance_mode,
                    "enabled": counterbalance_enabled,
                    "task_order_strict": task_order_strict,
                    "seed_source": "participant_external_id",
                    "permutation_index": permutation_index,
                    "permutations_total": permutations_total,
                },
                "participant_key": participant_key,
                "owner_username": owner_name_response,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "prolific_completion_mode": prolific_completion_mode,
                "prolific_completion_code": prolific_completion_code,
            },
            status=status.HTTP_201_CREATED,
        )


class SubmitResultView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = SubmitResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        envelope = store_result_envelope(
            run_session=run_session,
            trial_count=data["trial_count"],
            summary_json=data.get("result_summary", {}),
            result_payload=data["result_payload"],
        )

        trial_records_stored = store_trial_results(
            run_session=run_session,
            trials=data.get("trials", []),
        )

        run_session.status = data["status"]
        if data["status"] == RUN_STATUS_COMPLETED:
            run_session.completed_at = timezone.now()
        run_session.save(update_fields=["status", "completed_at"])

        record_audit(
            action="submit_result",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "status": run_session.status,
                "trial_count": data["trial_count"],
                "trial_records_stored": trial_records_stored,
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "result_envelope_id": envelope.id,
                "status": run_session.status,
                "stored": True,
                "trial_records_stored": trial_records_stored,
            },
            status=status.HTTP_201_CREATED,
        )


class DecryptResultView(APIView):
    """Protected decrypt/read endpoint for interim Day 6 privacy controls."""

    @transaction.atomic
    def post(self, request):
        serializer = DecryptResultRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        actor = _get_actor_from_request(request)

        if not request.user.is_authenticated:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "unauthenticated",
                    "include_trials": data.get("include_trials", False),
                },
            )
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

        profile = get_or_create_profile(request.user)
        mfa_enabled = bool(profile.mfa_enabled)
        if not mfa_enabled or not _is_mfa_session_fresh(request):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={
                    "reason": "mfa_required",
                    "mfa_enabled": mfa_enabled,
                },
            )
            return Response({"error": "MFA verification required"}, status=status.HTTP_403_FORBIDDEN)

        run_session = RunSession.objects.filter(id=data["run_session_id"]).first()
        if not run_session:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=data["run_session_id"],
                actor=actor,
                metadata={"reason": "run_session_not_found"},
            )
            return Response({"error": "Run session not found"}, status=status.HTTP_404_NOT_FOUND)

        study = getattr(run_session, "study", None)
        if not study or not _has_study_access(study, request.user, profile):
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "study_access_denied"},
            )
            return Response({"error": "Study is not shared with the current researcher"}, status=status.HTTP_403_FORBIDDEN)

        envelope = getattr(run_session, "result_envelope", None)
        if not envelope:
            record_audit(
                action="decrypt_result_denied",
                resource_type="run_session",
                resource_id=run_session.id,
                actor=actor,
                metadata={"reason": "result_envelope_not_found"},
            )
            return Response({"error": "Result envelope not found"}, status=status.HTTP_404_NOT_FOUND)

        result_payload = get_decrypted_envelope(envelope)
        include_trials = data.get("include_trials", False)
        trials = []
        if include_trials:
            for trial in run_session.trial_results.all().order_by("trial_index"):
                trials.append(get_decrypted_trial(trial))

        record_audit(
            action="decrypt_result",
            resource_type="run_session",
            resource_id=run_session.id,
            actor=actor,
            metadata={
                "include_trials": include_trials,
                "trial_records_returned": len(trials),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": run_session.study.slug,
                "status": run_session.status,
                "result_payload": result_payload,
                "trials": trials if include_trials else None,
            },
            status=status.HTTP_200_OK,
        )
