import os

from django.http import HttpResponse


class NewsletterCorsMiddleware:
    """Apply CORS headers for the public newsletter subscribe endpoint.

    This ensures headers are present even when the endpoint returns an error,
    which avoids opaque browser-side CORS failures that hide the real status code.
    """

    TARGET_PATH = "/api/v1/newsletter/subscribe"

    def __init__(self, get_response):
        self.get_response = get_response

    def _allowed_origins(self) -> set[str]:
        raw = os.getenv(
            "NEWSLETTER_CORS_ALLOWED_ORIGINS",
            "https://cogflow.app,https://www.cogflow.app,http://localhost:4177",
        )
        return {x.strip() for x in raw.split(",") if x.strip()}

    def _apply_headers(self, request, response):
        origin = (request.headers.get("Origin") or "").strip()
        if origin and origin in self._allowed_origins():
            response["Access-Control-Allow-Origin"] = origin
            response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            response["Access-Control-Allow-Headers"] = "Content-Type"
            response["Vary"] = "Origin"
        return response

    def __call__(self, request):
        if request.path == self.TARGET_PATH and request.method == "OPTIONS":
            response = HttpResponse(status=204)
            return self._apply_headers(request, response)

        response = self.get_response(request)
        if request.path == self.TARGET_PATH:
            response = self._apply_headers(request, response)
        return response
