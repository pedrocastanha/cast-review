import hmac
import os

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse


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
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response
