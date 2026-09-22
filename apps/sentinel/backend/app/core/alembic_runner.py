"""Run Alembic without the local ``alembic/`` scripts folder shadowing the library.

``PYTHONPATH=/app`` makes ``import alembic`` load ``/app/alembic`` (migration
scripts) instead of the installed package, so ``alembic upgrade head`` and
``from alembic.config import Config`` both fail with
``No module named 'alembic.config'``.
"""

from __future__ import annotations

import sys
from pathlib import Path


def backend_root() -> Path:
    return Path(__file__).resolve().parents[2]


def unshadow_alembic_library() -> Path:
    """Put site-packages ahead of /app so the Alembic *library* wins."""
    root = backend_root()
    site = [p for p in sys.path if "site-packages" in p.replace("\\", "/")]
    kept: list[str] = []
    for entry in sys.path:
        try:
            if Path(entry).resolve() == root:
                continue
        except OSError:
            pass
        if entry in site:
            continue
        kept.append(entry)
    sys.path[:] = site + kept + [str(root)]
    return root


def upgrade_head() -> None:
    root = unshadow_alembic_library()
    from alembic.config import Config
    from alembic import command

    cfg = Config(str(root / "alembic.ini"))
    command.upgrade(cfg, "head")
