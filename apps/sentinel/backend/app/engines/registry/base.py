"""
Base class for registry adapters.

Each registry (Puro.Earth, Verra, Gold Standard, …) implements this interface.
Swap adapters via env-vars — no code changes needed.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class RegistrySyncResult:
    registry_slug: str
    external_project_id: str
    status: str                                # active / pending / suspended / retired
    methodology_version: str | None = None
    credit_issued_to_date: float | None = None
    next_review_date: str | None = None        # ISO date string
    flags: list[str] = field(default_factory=list)   # e.g. ["methodology_update_available"]
    raw: dict[str, Any] = field(default_factory=dict)


class RegistryAdapter(ABC):
    """Abstract base adapter — implement one per registry."""

    @property
    @abstractmethod
    def slug(self) -> str:
        """Short identifier, e.g. 'puro_earth'."""

    @abstractmethod
    def fetch_project(self, external_project_id: str) -> RegistrySyncResult:
        """Fetch live data for a single project from the registry."""
