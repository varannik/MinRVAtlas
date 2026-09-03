"""
F021: Shared pagination helper — ensures all list endpoints return a consistent
      envelope: {"items": [...], "total": N, "offset": N, "limit": N}

Usage:
    from app.core.pagination import paginate, paginate_query

    # From a list:
    return paginate(items, total=len(items), offset=offset, limit=limit)

    # From a SQLAlchemy query:
    return paginate_query(query, offset=offset, limit=limit)
"""
from typing import Any, List, TypeVar

from sqlalchemy.orm import Query

T = TypeVar("T")


def paginate(items: List[Any], *, total: int, offset: int = 0, limit: int = 100) -> dict:
    """Wrap a list in the standard pagination envelope."""
    return {"items": items, "total": total, "offset": offset, "limit": limit}


def paginate_query(query: Query, *, offset: int = 0, limit: int = 100) -> dict:
    """Count, slice, and wrap a SQLAlchemy query in the standard envelope."""
    total: int = query.count()
    items = query.offset(offset).limit(limit).all()
    return paginate(items, total=total, offset=offset, limit=limit)
