FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 APP_ENV=production
WORKDIR /app
COPY apps/ai-api/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home cast
COPY --chown=cast:cast apps/ai-api/app ./app
USER cast
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
