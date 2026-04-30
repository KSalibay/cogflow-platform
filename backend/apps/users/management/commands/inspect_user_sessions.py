from django.contrib.auth.models import User
from django.contrib.sessions.models import Session
from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Inspect active Django sessions for one user or provide a global session summary."

    def add_arguments(self, parser):
        parser.add_argument(
            "--username",
            type=str,
            default="",
            help="Username to inspect. If omitted, prints a global active-session summary.",
        )

    def handle(self, *args, **options):
        username = (options.get("username") or "").strip()
        now = timezone.now()

        if username:
            user = User.objects.filter(username=username).first()
            if not user:
                self.stdout.write(self.style.ERROR(f"User not found: {username}"))
                return
            self._print_user_sessions(user, now)
            return

        active = Session.objects.filter(expire_date__gt=now)
        total = active.count()
        user_ids = set()
        for session in active.iterator():
            try:
                data = session.get_decoded()
            except Exception:
                continue
            uid = data.get("_auth_user_id")
            if uid:
                user_ids.add(str(uid))

        self.stdout.write(self.style.SUCCESS(f"Active sessions: {total}"))
        self.stdout.write(self.style.SUCCESS(f"Users with active sessions: {len(user_ids)}"))

    def _print_user_sessions(self, user, now):
        active = Session.objects.filter(expire_date__gt=now).order_by("-expire_date")
        hits = []
        for session in active.iterator():
            try:
                data = session.get_decoded()
            except Exception:
                continue
            if str(data.get("_auth_user_id", "")) == str(user.id):
                hits.append(
                    {
                        "session_key": session.session_key,
                        "expire_date": session.expire_date,
                        "mfa_verified_at": data.get("mfa_verified_at"),
                    }
                )

        if not hits:
            self.stdout.write(self.style.WARNING(f"No active sessions found for user: {user.username}"))
            return

        self.stdout.write(self.style.SUCCESS(f"Active sessions for {user.username}: {len(hits)}"))
        for idx, row in enumerate(hits, start=1):
            session_key = row["session_key"] or ""
            masked = f"{session_key[:8]}...{session_key[-6:]}" if len(session_key) > 16 else session_key
            self.stdout.write(
                f"{idx}. key={masked} expires={row['expire_date'].isoformat()} mfa_verified_at={row['mfa_verified_at']}"
            )
