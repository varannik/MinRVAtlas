"""
Isometric Registry Connector.
Implements the RegistryConnectorBase against Isometric's sandbox/production API.

Isometric API base: https://api.isometric.com  (or sandbox equivalent)
Auth: Bearer token (API key)

API endpoints used:
  GET  /v1/verifications           — list pending assignments
  POST /v1/verifications/{id}/accept
  POST /v1/verifications/{id}/decline
  GET  /v1/verifications/{id}/documents
  GET  /v1/verifications/{id}/car-responses
  POST /v1/verifications/{id}/cars
  PATCH /v1/verifications/{id}/cars/{car_id}
  POST /v1/verifications/{id}/statement

Adapt endpoint paths as you receive the official API docs.
"""
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.integrations.base import RegistryConnectorBase

logger = logging.getLogger("datasentinel.integrations.isometric")


class IsometricConnector(RegistryConnectorBase):

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        }

    def _url(self, path: str) -> str:
        ver = self.config.get("api_version", "v1")
        return f"{self.base_url}/{ver}{path}"

    async def fetch_pending_assignments(self) -> List[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    self._url("/verifications"),
                    headers=self._headers(),
                    params={"status": "pending_acceptance"},
                )
            resp.raise_for_status()
            raw_list = resp.json().get("data") or resp.json() or []
            return [self._normalise_assignment(r) for r in raw_list]
        except Exception as exc:
            logger.error("Isometric fetch_pending_assignments failed: %s", exc)
            return []

    async def fetch_car_responses(self, assignment_ref: str) -> List[Dict[str, Any]]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    self._url(f"/verifications/{assignment_ref}/car-responses"),
                    headers=self._headers(),
                )
            resp.raise_for_status()
            return resp.json().get("data") or []
        except Exception as exc:
            logger.error("Isometric fetch_car_responses failed: %s", exc)
            return []

    async def fetch_document_package(self, assignment_ref: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    self._url(f"/verifications/{assignment_ref}/documents"),
                    headers=self._headers(),
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric fetch_document_package failed: %s", exc)
            return {"documents": [], "error": str(exc)}

    async def accept_assignment(self, assignment_ref: str, reviewer_info: Dict) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    self._url(f"/verifications/{assignment_ref}/accept"),
                    headers=self._headers(),
                    json=reviewer_info,
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric accept_assignment failed: %s", exc)
            raise

    async def decline_assignment(self, assignment_ref: str, reason: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    self._url(f"/verifications/{assignment_ref}/decline"),
                    headers=self._headers(),
                    json={"reason": reason},
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric decline_assignment failed: %s", exc)
            raise

    async def submit_car(self, assignment_ref: str, car: Dict[str, Any]) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    self._url(f"/verifications/{assignment_ref}/cars"),
                    headers=self._headers(),
                    json=car,
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric submit_car failed: %s", exc)
            raise

    async def close_car(self, assignment_ref: str, car_ref: str, determination: str, note: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.patch(
                    self._url(f"/verifications/{assignment_ref}/cars/{car_ref}"),
                    headers=self._headers(),
                    json={"status": determination, "note": note},
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric close_car failed: %s", exc)
            raise

    async def submit_verification_statement(
        self,
        assignment_ref: str,
        statement: Dict[str, Any],
        document_bytes: Optional[bytes] = None,
    ) -> Dict[str, Any]:
        try:
            if document_bytes:
                # Multipart upload
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.post(
                        self._url(f"/verifications/{assignment_ref}/statement"),
                        headers={k: v for k, v in self._headers().items() if k != "Content-Type"},
                        files={"document": ("verification_statement.pdf", document_bytes, "application/pdf")},
                        data={"payload": str(statement)},
                    )
            else:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(
                        self._url(f"/verifications/{assignment_ref}/statement"),
                        headers=self._headers(),
                        json=statement,
                    )
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Isometric submit_verification_statement failed: %s", exc)
            raise


# ── Connector factory ───────────────────────────────────────────────────────

_CONNECTOR_MAP = {
    "isometric": IsometricConnector,
    # future: "puro_earth": PuroEarthConnector,
    # future: "gold_standard": GoldStandardConnector,
    # future: "verra": VerraConnector,
}


def get_connector(registry_slug: str, config: Dict[str, Any]) -> RegistryConnectorBase:
    """
    Return the correct connector instance for a registry slug.
    Falls back to a stub connector if the registry is not yet implemented.
    """
    cls = _CONNECTOR_MAP.get(registry_slug.lower())
    if not cls:
        raise ValueError(
            f"No connector implemented for registry '{registry_slug}'. "
            f"Supported: {list(_CONNECTOR_MAP.keys())}"
        )
    return cls(config)
