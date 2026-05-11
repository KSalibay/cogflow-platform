from .api_views_common import *

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
            soc_dashboard_js = interpreter_dir / "src" / "jspsych-soc-dashboard.js"
            mtimes = []
            for p in (main_js, timeline_compiler_js, soc_dashboard_js, index_path):
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


