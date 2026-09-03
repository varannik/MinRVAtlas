FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Create non-root user (FINDING-036)
RUN addgroup --system app && adduser --system --ingroup app app

RUN mkdir -p /app/uploads && chown -R app:app /app

USER app

ENV PYTHONPATH=/app
# Worker count is configurable via environment variable (FINDING-036)
ENV GUNICORN_WORKERS=2

EXPOSE 8000

# Application-level health check so ECS can detect app failures, not just TCP (FINDING-036)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Run Alembic migrations once before forking workers (avoids parallel DDL races).
# Use || true so a migration failure is logged but never prevents the server starting.
CMD ["sh", "-c", "alembic upgrade head && echo 'Migrations OK' || echo 'WARNING: alembic upgrade failed — check DB'; exec gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --workers ${GUNICORN_WORKERS} --timeout 120"]
