"""
MockPuroAdapter — deterministic fake registry data for development / staging.

Returns plausible-looking Puro.Earth data derived from the project UUID so
results are stable across calls (no random drift).  When real API credentials
are configured (PURO_API_KEY + PURO_API_URL), swap this for PuroEarthAdapter
with no logic changes needed.
"""
from __future__ import annotations

import hashlib
from datetime import date, timedelta

from .base import RegistryAdapter, RegistrySyncResult


_STATUSES      = ["active", "active", "active", "pending", "suspended"]
_METHODOLOGIES = [
    "PURO-CCS-GSC/GSC-2024-03",
    "PURO-BIOCHAR-V2/BIOCHAR-V2.1",
    "PURO-DAC-V1/DAC-V1.2",
    "PURO-EW-V1/EW-V1.1",
]


class MockPuroAdapter(RegistryAdapter):
    """Deterministic mock adapter — stable results from project UUID seed."""

    @property
    def slug(self) -> str:
        return "puro_earth"

    def fetch_project(self, external_project_id: str) -> RegistrySyncResult:
        # Use a stable hash of the project ID as an integer seed
        seed = int(hashlib.md5(external_project_id.encode()).hexdigest(), 16)  # noqa: S324

        status = _STATUSES[seed % len(_STATUSES)]
        methodology = _METHODOLOGIES[seed % len(_METHODOLOGIES)]
        credits = round((seed % 50_000) + 1_000, -2)          # 1000–51000, rounded to 100
        days_ahead = (seed % 300) + 30                         # 30–330 days from today
        next_review = (date.today() + timedelta(days=days_ahead)).isoformat()

        flags: list[str] = []
        # Simulate ~25% chance of a methodology update flag
        if (seed % 4) == 0:
            flags.append("methodology_update_available")
        # Simulate ~15% chance of a documentation gap flag
        if (seed % 7) == 0:
            flags.append("documentation_gap_detected")

        return RegistrySyncResult(
            registry_slug        = self.slug,
            external_project_id  = external_project_id,
            status               = status,
            methodology_version  = methodology,
            credit_issued_to_date = credits,
            next_review_date     = next_review,
            flags                = flags,
            raw                  = {
                "source":    "mock",
                "note":      "Simulated Puro.Earth data — swap PURO_API_KEY to use live registry",
                "id":        external_project_id,
                "status":    status,
                "credits":   credits,
                "flags":     flags,
            },
        )
