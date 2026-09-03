"""Shared SlowAPI rate-limiter instance.

Import this in routers to apply per-endpoint limits:
    from app.core.limiter import limiter
    @router.post("/token")
    @limiter.limit("10/minute")
    def login(request: Request, ...): ...

main.py wires app.state.limiter = limiter and the exception handler.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
