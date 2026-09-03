"""
F019: Alembic environment — uses the same DATABASE_URL as the FastAPI app.

Strategy:
  - startup.py creates tables idempotently on every container start (legacy)
  - Alembic handles incremental schema changes going forward
  - Run `alembic stamp head` after first deploy to mark the baseline as applied
  - Future changes: `alembic revision --autogenerate -m "description"`
                    `alembic upgrade head`

CI usage:
  alembic upgrade head   (idempotent — safe to run on every deploy)
"""
import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# Make sure the app package is importable when running alembic CLI from backend/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.core.database import Base  # noqa: F401

# Import all models so their tables appear in metadata
import app.models  # noqa: F401

# ── Alembic Config ────────────────────────────────────────────────────────────
config = context.config

# Override the sqlalchemy.url from alembic.ini with the live DATABASE_URL
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


# ── Offline migrations (generate SQL without a live DB) ───────────────────────

def run_migrations_offline() -> None:
    """Generate a .sql script without connecting to the database."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online migrations (connect and apply) ─────────────────────────────────────

def run_migrations_online() -> None:
    """Apply migrations to a live database connection."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,          # detect column type changes
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
