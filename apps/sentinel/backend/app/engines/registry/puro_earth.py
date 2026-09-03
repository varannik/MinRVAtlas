"""
PuroEarthAdapter — live Puro.Earth registry integration (stub).

Activated when both PURO_API_KEY and PURO_API_URL env-vars are set.
Replace the stub body with real HTTP calls once Puro API docs are available.
"""
from __future__ import annotations

import os

import httpx

from .base import RegistryAdapter, RegistrySyncResult


class PuroEarthAdapter(RegistryAdapter):
    """Live adapter for Puro.Earth registry API."""

    def __init__(self) -> None:
        self._api_key = os.environ["PURO_API_KEY"]
        self._base_url = os.environ["PURO_API_URL"].rstrip("/")

    @property
    def slug(self) -> str:
        return "puro_earth"

    def fetch_project(self, external_project_id: str) -> RegistrySyncResult:
        """Fetch a single project from the live Puro.Earth API."""
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "application/json"}
        url = f"{self._base_url}/v1/projects/{external_project_id}"

        resp = httpx.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        return RegistrySyncResult(
            registry_slug        = self.slug,
            external_project_id  = external_project_id,
            status               = data.get("status", "unknown"),
            methodology_version  = data.get("methodology_version"),
            credit_issued_to_date = data.get("credits_issued"),
            next_review_date     = data.get("next_review_date"),
            flags                = data.get("flags", []),
            raw                  = data,
        )


def get_adapter() -> RegistryAdapter:
    """
    Factory: returns PuroEarthAdapter when credentials are present,
    MockPuroAdapter otherwise — zero config required for development.
    """
    from .mock_puro import MockPuroAdapter  # local import avoids circular

    if os.environ.get("PURO_API_KEY") and os.environ.get("PURO_API_URL"):
        return PuroEarthAdapter()
    return MockPuroAdapter()
