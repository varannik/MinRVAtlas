import logging
import secrets
from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings

_cfg_log = logging.getLogger("datasentinel.config")


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://datasentinel:datasentinel_dev@localhost:5432/datasentinel"
    REDIS_URL: str = "redis://localhost:6379/0"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    # Shared secret for the 3DMinRV BFF (Authorization: Bearer). Not a user JWT.
    SENTINEL_SERVICE_TOKEN: str = ""
    ENVIRONMENT: str = "development"
    UPLOAD_DIR: str = "/app/uploads"
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    # Azure OpenAI (Microsoft Foundry)
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = ""
    AZURE_OPENAI_DEPLOYMENT: str = ""
    AZURE_OPENAI_API_VERSION: str = "2024-02-15-preview"
    # LLM provider: "anthropic" | "openai" | "azure_openai"
    LLM_PROVIDER: str = "azure_openai"
    LLM_MODEL: str = ""
    SENTRY_DSN: str = ""
    AWS_S3_BUCKET: str = ""
    AWS_REGION: str = ""
    # Microsoft Entra ID SSO
    MICROSOFT_CLIENT_ID: str = ""
    MICROSOFT_CLIENT_SECRET: str = ""
    MICROSOFT_TENANT_ID: str = ""
    FRONTEND_URL: str = "http://localhost:3000"
    # Email / SMTP
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    ALERT_EMAIL_FROM: str = ""
    ALERT_EMAIL_TO: str = ""

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, v: str) -> str:
        weak = "dev-secret-key-change-in-production"
        if v == weak and __import__("os").environ.get("ENVIRONMENT", "development") == "production":
            # Do NOT raise — that crashes startup before the app can serve /api/health.
            # Log a CRITICAL alert and generate a per-process random key instead.
            # JWTs will be invalidated on each restart until SECRET_KEY is set properly.
            random_key = secrets.token_hex(32)
            _cfg_log.critical(
                "SECRET_KEY is the insecure default in a production environment! "
                "Set SECRET_KEY to a stable random value in your ECS task definition. "
                "Using a per-process random key for this session (all existing tokens are now invalid). "
                "Generate a stable key with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
            return random_key
        return v

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings():
    return Settings()


settings = get_settings()
