"""
Abstract base class for registry connectors.
Every registry (Isometric, Puro.Earth, Gold Standard, Verra, etc.)
implements this interface.  The Reviewer Platform never talks to a
specific registry directly — it always uses this interface.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class RegistryConnectorBase(ABC):
    """
    Pluggable registry connector.
    Concrete implementations live in their own modules (isometric.py, etc.).
    """

    def __init__(self, config: Dict[str, Any]):
        """
        config keys (from registry_connectors table):
          base_url, api_key, client_id, client_secret,
          api_version, webhook_secret, sandbox_mode
        """
        self.config = config
        self.base_url = config.get("base_url", "").rstrip("/")
        self.api_key = config.get("api_key")
        self.sandbox_mode = config.get("sandbox_mode", False)

    # ── Inbound: what the registry pushes / we poll ────────────────────────

    @abstractmethod
    async def fetch_pending_assignments(self) -> List[Dict[str, Any]]:
        """
        Poll the registry for new project assignments awaiting acceptance.
        Returns a list of normalised assignment dicts.
        """

    @abstractmethod
    async def fetch_car_responses(self, assignment_ref: str) -> List[Dict[str, Any]]:
        """
        Fetch company CAR responses for a given assignment.
        Returns list of response dicts.
        """

    @abstractmethod
    async def fetch_document_package(self, assignment_ref: str) -> Dict[str, Any]:
        """
        Retrieve the document package metadata for an assignment.
        Returns {documents: [{name, type, download_url, size}], package_ref}
        """

    # ── Outbound: what we push to the registry ─────────────────────────────

    @abstractmethod
    async def accept_assignment(self, assignment_ref: str, reviewer_info: Dict) -> Dict[str, Any]:
        """Accept a registry assignment. Returns confirmation."""

    @abstractmethod
    async def decline_assignment(self, assignment_ref: str, reason: str) -> Dict[str, Any]:
        """Decline an assignment with a reason."""

    @abstractmethod
    async def submit_car(self, assignment_ref: str, car: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submit a CAR to the registry (which forwards to the company via DMRV).
        Returns {registry_car_ref, submitted_at}
        """

    @abstractmethod
    async def close_car(self, assignment_ref: str, car_ref: str, determination: str, note: str) -> Dict[str, Any]:
        """Mark a CAR as closed/rejected at the registry level."""

    @abstractmethod
    async def submit_verification_statement(
        self,
        assignment_ref: str,
        statement: Dict[str, Any],
        document_bytes: Optional[bytes] = None,
    ) -> Dict[str, Any]:
        """
        Submit the final verification statement to the registry.
        Returns {registry_ref_number, submitted_at, status}
        """

    # ── Webhook verification ────────────────────────────────────────────────

    def verify_webhook(self, payload_bytes: bytes, signature_header: str) -> bool:
        """
        Verify an inbound webhook signature.
        Default: HMAC-SHA256 over payload with webhook_secret.
        Override for registries that use different signing schemes.
        """
        import hashlib
        import hmac
        secret = self.config.get("webhook_secret", "")
        if not secret:
            return True  # no secret configured — accept (dev mode)
        expected = hmac.new(
            secret.encode(), payload_bytes, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header.lstrip("sha256="))

    # ── Normalisation helpers (shared) ─────────────────────────────────────

    @staticmethod
    def _normalise_assignment(raw: Dict[str, Any]) -> Dict[str, Any]:
        """
        Return a registry-agnostic assignment dict.
        Concrete connectors call this after parsing registry-specific JSON.
        """
        return {
            "registry_assignment_ref": raw.get("id") or raw.get("assignment_id"),
            "registry_project_ref":    raw.get("project_id"),
            "project_name":            raw.get("project_name") or raw.get("name", "Unknown"),
            "company_name":            raw.get("company_name") or raw.get("developer_name"),
            "company_id":              raw.get("company_id")   or raw.get("developer_id"),
            "methodology_code":        raw.get("methodology")  or raw.get("methodology_code"),
            "methodology_version":     raw.get("methodology_version"),
            "credit_type":             raw.get("credit_type"),
            "vintage_year":            raw.get("vintage_year"),
            "country":                 raw.get("country")      or raw.get("location"),
            "credit_quantity_claimed": raw.get("credit_quantity") or raw.get("claimed_tonnes"),
            "deadline":                raw.get("deadline")     or raw.get("review_deadline"),
            "document_package_ref":    raw.get("document_package_url") or raw.get("documents_ref"),
            "raw_payload":             raw,
        }
