import os
import json
import re
import hashlib
import math
import mimetypes
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
from django.http import FileResponse, HttpResponseRedirect
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
from apps.studies.models import (
    Study,
    StudyResearcherAccess,
    StudyAnalysisReportArtifact,
    StudyAnalysisReportJob,
)
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
    ShareStudyValidateUserRequestSerializer,
    StudyAnalysisReportJobCreateRequestSerializer,
    AuthLoginRequestSerializer,
    PasswordResetConfirmRequestSerializer,
    PasswordResetRequestSerializer,
    AuthRegisterRequestSerializer,
    FeedbackSubmitRequestSerializer,
    CreateParticipantLinkRequestSerializer,
    DecryptResultRequestSerializer,
    PublishConfigRequestSerializer,
    StartRunRequestSerializer,
    StudyAnalysisReportRequestSerializer,
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


def _record_auth_rejection(request, endpoint: str, reason: str, metadata: dict | None = None):
    """Record lightweight diagnostics for unauthenticated request rejections."""
    try:
        extra = metadata.copy() if isinstance(metadata, dict) else {}
        cookie_header = request.META.get("HTTP_COOKIE", "") or ""
        session_cookie_name = settings.SESSION_COOKIE_NAME
        csrf_cookie_name = settings.CSRF_COOKIE_NAME
        record_audit(
            action="auth_rejected",
            resource_type="auth",
            resource_id=endpoint,
            actor="anonymous",
            metadata={
                "endpoint": endpoint,
                "reason": reason,
                "method": request.method,
                "path": request.path,
                "has_session_cookie": f"{session_cookie_name}=" in cookie_header,
                "has_csrf_cookie": f"{csrf_cookie_name}=" in cookie_header,
                "secure_request": bool(request.is_secure()),
                "x_forwarded_proto": request.META.get("HTTP_X_FORWARDED_PROTO", ""),
                "origin": request.META.get("HTTP_ORIGIN", ""),
                "referer": request.META.get("HTTP_REFERER", ""),
                "user_agent": (request.META.get("HTTP_USER_AGENT", "") or "")[:180],
                **extra,
            },
        )
    except Exception:
        pass


def _can_manage_researcher_resources(request, profile) -> bool:
    if not request.user.is_authenticated:
        return False
    return profile.role in {profile.ROLE_ADMIN, profile.ROLE_RESEARCHER}


def _owner_study_permissions() -> dict:
    return {
        "can_run_analysis": True,
        "can_download_aggregate": True,
        "can_view_run_rows": True,
        "can_view_pseudonyms": True,
        "can_view_full_payload": True,
        "can_manage_sharing": True,
        "can_remove_users": True,
    }


def _can_manage_study_scope(request, profile, study: Study | None) -> bool:
    if not request.user.is_authenticated:
        return False
    if study and study.owner_user_id == request.user.id:
        return True
    return _can_manage_researcher_resources(request, profile)


def _ensure_owner_access_record(study: Study | None, owner_user, granted_by=None):
    """Ensure owner has a full-permission StudyResearcherAccess row.

    Owner authorization checks do not depend on this row, but maintaining it keeps
    persisted collaborator permissions consistent for legacy/backfilled data paths.
    """
    if not study or not owner_user:
        return None

    owner_perms = _owner_study_permissions()
    defaults = {
        "granted_by": granted_by or owner_user,
        **owner_perms,
    }
    access, _created = StudyResearcherAccess.objects.get_or_create(
        study=study,
        user=owner_user,
        defaults=defaults,
    )

    changed = []
    for key, value in owner_perms.items():
        if getattr(access, key) != value:
            setattr(access, key, value)
            changed.append(key)

    if not access.granted_by_id:
        access.granted_by = granted_by or owner_user
        changed.append("granted_by")

    if changed:
        access.save(update_fields=changed)

    return access


def _can_access_analysis_resources(request, profile) -> bool:
    if not request.user.is_authenticated:
        return False
    return profile.role in {profile.ROLE_ADMIN, profile.ROLE_RESEARCHER, profile.ROLE_ANALYST}


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


def _is_study_publish_actor(study: Study, user) -> bool:
    """Back-compat fallback: treat original publish actor as study owner-like access.

    This covers older studies where owner/share metadata may be incomplete but
    audit history has the correct publisher identity.
    """
    if not study or not user or not getattr(user, "is_authenticated", False):
        return False
    return AuditEvent.objects.filter(
        action="publish_config",
        resource_type="study",
        resource_id=str(study.id),
        actor=user.username,
    ).exists()


def _is_legacy_public_study(study: Study) -> bool:
    """Legacy studies created before ownership rollout: no owner and no explicit shares."""
    if not study:
        return False
    if study.owner_user_id:
        return False
    return not StudyResearcherAccess.objects.filter(study=study).exists()


def _get_study_access_record(study: Study, user):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if study.owner_user_id == user.id:
        return None
    return StudyResearcherAccess.objects.filter(study=study, user=user).first()


def _study_access_permissions(study: Study, user, profile) -> dict:
    if not user or not getattr(user, "is_authenticated", False):
        return {
            "can_run_analysis": False,
            "can_download_aggregate": False,
            "can_view_run_rows": False,
            "can_view_pseudonyms": False,
            "can_view_full_payload": False,
            "can_manage_sharing": False,
            "can_remove_users": False,
        }

    if study.owner_user_id == user.id:
        return _owner_study_permissions()

    access = _get_study_access_record(study, user)
    if not access:
        return {
            "can_run_analysis": False,
            "can_download_aggregate": False,
            "can_view_run_rows": False,
            "can_view_pseudonyms": False,
            "can_view_full_payload": False,
            "can_manage_sharing": False,
            "can_remove_users": False,
        }

    return {
        "can_run_analysis": bool(access.can_run_analysis),
        "can_download_aggregate": bool(access.can_download_aggregate),
        "can_view_run_rows": bool(access.can_view_run_rows),
        "can_view_pseudonyms": bool(access.can_view_pseudonyms),
        "can_view_full_payload": bool(access.can_view_full_payload),
        "can_manage_sharing": bool(access.can_manage_sharing),
        "can_remove_users": bool(access.can_remove_users),
    }


def _can_remove_study_users(study: Study, user, profile) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if profile.role == profile.ROLE_ADMIN:
        return True
    if study.owner_user_id == user.id:
        return True
    access = _get_study_access_record(study, user)
    if not access:
        return False
    return bool(access.can_remove_users or access.can_manage_sharing)


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


# Explicitly export all shared symbols, including underscore-prefixed helpers,
# so split api_views modules importing with `from .api_views_common import *`
# receive the private helper functions they depend on.
__all__ = [name for name in globals() if not name.startswith("__")]


