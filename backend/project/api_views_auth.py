from .api_views_common import *

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
        requested_role = data.get("requested_role") or UserProfile.ROLE_RESEARCHER

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
        profile.role = requested_role
        profile.save(update_fields=["role"])

        record_audit(
            action="auth_register_requested",
            resource_type="user",
            resource_id=user.id,
            actor=username,
            metadata={"email": email, "requested_role": requested_role, "default_role": profile.role},
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
        profile.mfa_totp_secret_encrypted = ""
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
            _record_auth_rejection(request, endpoint="auth/me", reason="unauthenticated")
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


