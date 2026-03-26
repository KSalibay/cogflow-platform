import os
import json
import hashlib
from datetime import timedelta
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from email.mime.image import MIMEImage

import pyotp
from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.core import signing
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.db.models import Count, Max, Q
from django.http import HttpResponseRedirect
from django.shortcuts import render
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditEvent
from apps.configs.models import ConfigVersion
from apps.runs.models import RunSession
from apps.studies.models import Study, StudyResearcherAccess
from apps.users.models import UserProfile
from apps.users.services import get_or_create_profile
from apps.results.services import (
    get_decrypted_envelope,
    get_decrypted_trial,
    store_result_envelope,
    store_trial_results,
)
from project.api_serializers import (
    AdminCreateUserRequestSerializer,
    AdminUpdateUserActivationRequestSerializer,
    AdminUpdateUserRoleRequestSerializer,
    AssignStudyOwnerRequestSerializer,
    ShareStudyRequestSerializer,
    AuthLoginRequestSerializer,
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
    if profile.role == profile.ROLE_ADMIN:
        return True
    if study.owner_user_id == user.id:
        return True
    return StudyResearcherAccess.objects.filter(study=study, user=user).exists()


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


def _portal_auth_redirect(request, msg: str, mode: str = "login") -> HttpResponseRedirect:
    portal_url = os.getenv("COGFLOW_PLATFORM_URL", "").strip() or request.build_absolute_uri("/portal/")
    normalized = portal_url.rstrip("/")
    if normalized.endswith("/portal"):
        base = normalized + "/"
    else:
        base = normalized + "/portal/"
    query = urlencode({"auth_mode": mode, "auth_msg": msg})
    return HttpResponseRedirect(f"{base}?{query}")


class AuthLoginView(APIView):
    """Session login endpoint for portal user flows."""

    @transaction.atomic
    def post(self, request):
        serializer = AuthLoginRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        existing_user = User.objects.filter(username=data["username"]).only("is_active").first()
        if existing_user and not existing_user.is_active:
            return Response(
                {"error": "Please verify your email before signing in."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user = authenticate(request, username=data["username"], password=data["password"])
        if not user:
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
                    <body style=\"margin:0;padding:0;background:#f3f5f8;font-family:Arial,sans-serif;color:#1f2937;\">
                        <table role=\"presentation\" width=\"100%\" cellspacing=\"0\" cellpadding=\"0\" style=\"padding:24px 0;\">
                            <tr>
                                <td align=\"center\">
                                    <table role=\"presentation\" width=\"560\" cellspacing=\"0\" cellpadding=\"0\" style=\"background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;\">
                                        <tr>
                                            <td align=\"center\" style=\"padding-bottom:16px;\">
                                                <img src=\"cid:cogflow-logo\" alt=\"CogFlow\" style=\"max-width:220px;height:auto;display:block;\" />
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style=\"font-size:15px;line-height:1.6;\">
                                                <p style=\"margin:0 0 12px;\">Your CogFlow account has been created.</p>
                                                <p style=\"margin:0 0 16px;\">Please verify your email to activate sign-in:</p>
                                                <p style=\"margin:0 0 20px;\">
                                                    <a href=\"{verify_url}\" style=\"display:inline-block;background:#30334a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600;\">Verify Email</a>
                                                </p>
                                                <p style=\"margin:0 0 10px;word-break:break-all;\"><a href=\"{verify_url}\" style=\"color:#30334a;\">{verify_url}</a></p>
                                                <p style=\"margin:0 0 10px;\">Portal: <a href=\"{portal_url}\" style=\"color:#30334a;\">{portal_url}</a></p>
                                                <p style=\"margin:0;color:#6b7280;\">If you did not request this account, you can ignore this email.</p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </body>
                </html>
                """

                msg = EmailMultiAlternatives(
                        subject=subject,
                        body=text_body,
                        from_email=os.getenv("DEFAULT_FROM_EMAIL", "noreply@localhost"),
                        to=[email],
                )
                msg.attach_alternative(html_body, "text/html")

                logo_path = settings.BASE_DIR.parent / "frontend" / "builder" / "img" / "logo_dark.png"
                if logo_path.exists():
                        with logo_path.open("rb") as fh:
                                logo = MIMEImage(fh.read())
                        logo.add_header("Content-ID", "<cogflow-logo>")
                        logo.add_header("Content-Disposition", "inline", filename="logo_dark.png")
                        msg.mixed_subtype = "related"
                        msg.attach(logo)

                msg.send(fail_silently=True)
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
        html = index_path.read_text(encoding="utf-8")
        html = html.replace(
            "window.COGFLOW_PLATFORM_URL    = '';",
            f"window.COGFLOW_PLATFORM_URL    = '{platform_url}';",
        )
        return HttpResponse(html, content_type="text/html; charset=utf-8")


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
        return HttpResponse(html, content_type="text/html; charset=utf-8")


@method_decorator(ensure_csrf_cookie, name="dispatch")
class PortalDashboardView(APIView):
    """Serve the portal dashboard draft as a Django template."""

    schema = None

    def get(self, request):
        return render(request, "portal/index.html")


class StudiesListView(APIView):
    def get(self, request):
        studies_qs = Study.objects.all()
        if request.user.is_authenticated:
            profile = get_or_create_profile(request.user)
            if profile.role == profile.ROLE_RESEARCHER:
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
        for run in study.run_sessions.select_related("owner_user", "result_envelope").order_by("-started_at")[:20]:
            envelope = getattr(run, "result_envelope", None)
            runs.append(
                {
                    "run_session_id": run.id,
                    "status": run.status,
                    "started_at": run.started_at,
                    "completed_at": run.completed_at,
                    "owner_username": run.owner_user.username if run.owner_user else _get_study_owner_username(study),
                    "participant_key_preview": f"{run.participant_key[:12]}..." if run.participant_key else None,
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


class PublishConfigView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = PublishConfigRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study, _ = Study.objects.update_or_create(
            slug=data["study_slug"],
            defaults={
                "name": data["study_name"],
                "runtime_mode": data["runtime_mode"],
            },
        )

        actor = _get_actor_from_request(request)
        if request.user.is_authenticated:
            profile = get_or_create_profile(request.user)
            if _can_manage_researcher_resources(request, profile):
                if study.owner_user_id and not _has_study_access(study, request.user, profile):
                    return Response(
                        {"error": "Study is not shared with the current researcher"},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if not study.owner_user_id or study.owner_user_id == request.user.id or profile.role == profile.ROLE_ADMIN:
                    study.owner_user = request.user
                    study.save(update_fields=["owner_user"])
                elif study.owner_user_id != request.user.id:
                    StudyResearcherAccess.objects.get_or_create(
                        study=study,
                        user=request.user,
                        defaults={"granted_by": request.user},
                    )

        config_version, _ = ConfigVersion.objects.update_or_create(
            study=study,
            version_label=data["config_version_label"],
            defaults={
                "builder_version": data.get("builder_version", ""),
                "config_json": data["config"],
            },
        )

        study.updated_at = timezone.now()
        study.save(update_fields=["updated_at"])

        record_audit(
            action="publish_config",
            resource_type="study",
            resource_id=study.id,
            actor=actor,
            metadata={"version_label": config_version.version_label},
        )

        return Response(
            {
                "study_id": study.id,
                "config_version_id": config_version.id,
                "study_slug": study.slug,
                "owner_username": _get_study_owner_username(study),
                "owner_usernames": _get_study_owner_usernames(study),
                "dashboard_url": f"/portal/studies/{study.slug}",
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

        expires_at = timezone.now() + timedelta(hours=data.get("expires_in_hours", 72))
        participant_external_id = (data.get("participant_external_id") or "").strip()
        completion_redirect_url = (data.get("completion_redirect_url") or "").strip()
        abort_redirect_url = (data.get("abort_redirect_url") or "").strip()
        base_payload = {
            "study_slug": study.slug,
            "researcher_username": request.user.username,
            "participant_external_id": participant_external_id,
            "expires_at": expires_at.isoformat(),
            "completion_redirect_url": completion_redirect_url,
            "abort_redirect_url": abort_redirect_url,
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
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
                "launch_options": {
                    "multi_use": {
                        "launch_mode": "multi_use",
                        "launch_token": multi_use_token,
                        "launch_url": launch_url_multi,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
                    },
                    "single_use": {
                        "launch_mode": "single_use",
                        "launch_token": single_use_token,
                        "launch_url": launch_url_single,
                        "completion_redirect_url": completion_redirect_url,
                        "abort_redirect_url": abort_redirect_url,
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
        if not already_owner:
            _, created = StudyResearcherAccess.objects.get_or_create(
                study=study,
                user=target_user,
                defaults={"granted_by": request.user},
            )

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
            },
        )

        return Response(
            {
                "ok": True,
                "study_slug": study.slug,
                "shared_with": target_user.username,
                "already_shared": already_owner or (not created),
                "owner_usernames": _get_study_owner_usernames(study),
            },
            status=status.HTTP_200_OK,
        )


class StartRunView(APIView):
    @transaction.atomic
    def post(self, request):
        serializer = StartRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        study = None
        owner_username = None
        launch_mode = None
        launch_token_digest = None

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

        config_version = study.config_versions.first()
        if not config_version:
            return Response({"error": "No published config version"}, status=status.HTTP_400_BAD_REQUEST)

        participant_external_id = (
            data.get("participant_external_id")
            or (token_payload.get("participant_external_id") if launch_token else "")
            or "anonymous"
        )
        participant_key = hash_identifier(participant_external_id)

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

        record_audit(
            action="start_run",
            resource_type="run_session",
            resource_id=run_session.id,
            metadata={
                "study_slug": study.slug,
                "owner_username": owner_name_response,
                "launch_mode": launch_mode,
                "launch_token_digest": launch_token_digest,
                "has_completion_redirect": bool(completion_redirect_url),
                "has_abort_redirect": bool(abort_redirect_url),
            },
        )

        return Response(
            {
                "run_session_id": run_session.id,
                "study_slug": study.slug,
                "config_version_id": config_version.id,
                "config": config_version.config_json,
                "participant_key": participant_key,
                "owner_username": owner_name_response,
                "completion_redirect_url": completion_redirect_url,
                "abort_redirect_url": abort_redirect_url,
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
