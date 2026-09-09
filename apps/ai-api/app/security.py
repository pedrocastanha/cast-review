import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

DEFAULT_MAX_REQUEST_BYTES = 32 * 1024 * 1024


def max_request_bytes() -> int:
    raw = os.environ.get("MAX_REQUEST_BYTES", "").strip()
    if not raw:
        return DEFAULT_MAX_REQUEST_BYTES
    value = int(raw)
    if value <= 0:
        raise RuntimeError("MAX_REQUEST_BYTES inválido")
    return value


class ServiceAuthentication(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        key = os.environ.get("AI_SERVICE_TOKEN", "")
        production = os.environ.get("APP_ENV") == "production"
        if production and len(key) < 32:
            return JSONResponse({"message": "Service unavailable"}, status_code=503)
        if request.url.path != "/health" and key:
            supplied = request.headers.get("authorization", "")
            if not hmac.compare_digest(supplied.encode(), f"Bearer {key}".encode()):
                return JSONResponse({"message": "Unauthorized"}, status_code=401)

        declared = request.headers.get("content-length")
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                return JSONResponse({"message": "Invalid Content-Length"}, status_code=400)
            if length > max_request_bytes():
                return JSONResponse({"message": "Payload too large"}, status_code=413)

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
