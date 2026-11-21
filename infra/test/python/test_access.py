"""Tenant and project isolation rules for Cortex tools (no AWS needed)."""

import base64
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import access  # noqa: E402
import migrate  # noqa: E402


def token(**claims):
    def part(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

    base = {"token_use": "access", "sub": "user-1", "tenant_id": "fourfourone", "role": "operator"}
    base.update(claims)
    return f"{part({'alg': 'RS256'})}.{part(base)}.signature"


def call(tool="knowledge___search", arguments=None, method="tools/call", **claims):
    body = {"jsonrpc": "2.0", "id": 7, "method": method}
    if method == "tools/call":
        body["params"] = {"name": tool, "arguments": arguments or {}}
    return {
        "interceptorInputVersion": "1.0",
        "mcp": {"gatewayRequest": {"headers": {"Authorization": f"Bearer {token(**claims)}"}, "body": body}},
    }


# Tenant fourfourone has two projects; user-1 holds a grant on fujairah only.
TENANCY = {
    ("fourfourone", "user-1"): ("active", ["fujairah", "oman-pilot"], ["fujairah"]),
    ("fourfourone", "admin-1"): ("active", ["fujairah", "oman-pilot"], []),
    ("verdant", "user-9"): ("active", ["verdant-site"], ["verdant-site"]),
    ("paused", "user-5"): ("suspended", ["p1"], ["p1"]),
}


def lookup(tenant, sub):
    return TENANCY.get((tenant, sub), ("missing", [], []))


def denied(output):
    return output["mcp"].get("transformedGatewayResponse", {}).get("body", {}).get("error")


def arguments(output):
    return output["mcp"]["transformedGatewayRequest"]["body"]["params"]["arguments"]


class InterceptorTests(unittest.TestCase):
    def test_granted_project_gets_a_caller_block(self):
        output, decision = access.intercept(call(arguments={"query": "bubble point", "project_id": "fujairah"}), lookup)
        self.assertIsNone(denied(output))
        caller = arguments(output)["caller"]
        self.assertEqual(caller["tenant_id"], "fourfourone")
        self.assertEqual(caller["project_id"], "fujairah")
        self.assertEqual(caller["project_ids"], ["fujairah"])
        self.assertTrue(decision["allowed"])

    def test_project_without_grant_is_refused(self):
        output, decision = access.intercept(call(arguments={"project_id": "oman-pilot"}), lookup)
        self.assertEqual(denied(output)["code"], access.DENIED_CODE)
        self.assertFalse(decision["allowed"])

    def test_another_tenants_project_is_refused(self):
        output, _ = access.intercept(call(arguments={"project_id": "verdant-site"}), lookup)
        self.assertIsNotNone(denied(output))

    def test_client_cannot_supply_its_own_caller_block(self):
        forged = {"tenant_id": "verdant", "project_ids": ["verdant-site"], "project_id": "verdant-site", "role": "tenant_admin"}
        output, _ = access.intercept(call(arguments={"query": "x", "caller": forged}), lookup)
        caller = arguments(output)["caller"]
        self.assertEqual(caller["tenant_id"], "fourfourone")
        self.assertEqual(caller["project_ids"], ["fujairah"])
        self.assertEqual(caller["role"], "operator")

    def test_tenant_admin_sees_every_project_in_own_tenant_only(self):
        output, _ = access.intercept(call(arguments={"project_id": "oman-pilot"}, sub="admin-1", role="tenant_admin"), lookup)
        self.assertIsNone(denied(output))
        self.assertEqual(arguments(output)["caller"]["project_ids"], ["fujairah", "oman-pilot"])
        output, _ = access.intercept(call(arguments={"project_id": "verdant-site"}, sub="admin-1", role="tenant_admin"), lookup)
        self.assertIsNotNone(denied(output))

    def test_token_without_tenant_cannot_even_list_tools(self):
        output, _ = access.intercept(call(method="tools/list", tenant_id=None), lookup)
        self.assertIsNotNone(denied(output))

    def test_id_token_is_refused(self):
        output, _ = access.intercept(call(token_use="id"), lookup)
        self.assertIsNotNone(denied(output))

    def test_malformed_tenant_id_is_refused(self):
        for bad in ("Four#One", "../x", "a", "*"):
            output, _ = access.intercept(call(tenant_id=bad), lookup)
            self.assertIsNotNone(denied(output), bad)

    def test_unknown_or_suspended_tenant_is_refused(self):
        output, _ = access.intercept(call(tenant_id="nobody"), lookup)
        self.assertIsNotNone(denied(output))
        output, _ = access.intercept(call(tenant_id="paused", sub="user-5", arguments={"project_id": "p1"}), lookup)
        self.assertIsNotNone(denied(output))

    def test_missing_bearer_is_refused(self):
        event = call()
        event["mcp"]["gatewayRequest"]["headers"] = {}
        output, _ = access.intercept(event, lookup)
        self.assertIsNotNone(denied(output))

    def test_list_passes_through_unchanged(self):
        output, _ = access.intercept(call(method="tools/list"), lookup)
        self.assertEqual(output["mcp"]["transformedGatewayRequest"]["body"]["method"], "tools/list")

    def test_unknown_role_falls_back_to_viewer(self):
        output, _ = access.intercept(call(role="superuser", arguments={"project_id": "fujairah"}), lookup)
        self.assertEqual(arguments(output)["caller"]["role"], "viewer")

    def test_tools_refuse_calls_that_skipped_the_gateway(self):
        with self.assertRaises(access.Denied):
            access.require_caller({"query": "x"})
        with self.assertRaises(access.Denied):
            access.require_caller({"caller": {"tenant_id": "Bad#Id", "project_ids": []}})


CALLER = {"tenant_id": "fourfourone", "role": "operator", "sub": "user-1", "project_ids": ["fujairah"], "project_id": "fujairah"}


class KnowledgeScopeTests(unittest.TestCase):
    def test_filter_has_shared_tenant_and_granted_project_only(self):
        f = access.retrieval_filter(CALLER, {"methodology": "puro-gsc", "edition": "2024-v5"})
        self.assertEqual(len(f["orAll"]), 3)
        text = json.dumps(f)
        self.assertIn('"fujairah"', text)
        self.assertNotIn("oman-pilot", text)
        self.assertIn('"puro-gsc"', text)

    def test_shared_documents_are_narrowed_to_the_projects_registry_too(self):
        f = access.retrieval_filter(CALLER, {"registry": "puro", "methodology": "puro-gsc", "edition": "2024-v5"})
        shared = f["orAll"][0]["andAll"]
        self.assertEqual(shared[0], {"equals": {"key": "scope", "value": "shared"}})
        self.assertEqual(
            shared[1:],
            [
                {"in": {"key": "registry", "value": ["puro", "any"]}},
                {"in": {"key": "methodology", "value": ["puro-gsc", "any"]}},
                {"in": {"key": "edition", "value": ["2024-v5", "any"]}},
            ],
        )

    def test_filter_without_project_has_no_project_clause(self):
        f = access.retrieval_filter({**CALLER, "project_id": None})
        self.assertEqual(len(f["orAll"]), 2)
        self.assertNotIn('"project"', json.dumps(f))

    def test_filter_refuses_ungranted_project(self):
        with self.assertRaises(access.Denied):
            access.retrieval_filter({**CALLER, "project_id": "oman-pilot"})

    def test_result_post_check(self):
        self.assertTrue(access.visible(CALLER, {"scope": "shared"}))
        self.assertTrue(access.visible(CALLER, {"scope": "tenant", "tenant_id": "fourfourone"}))
        self.assertTrue(access.visible(CALLER, {"scope": "project", "tenant_id": "fourfourone", "project_id": "fujairah"}))
        self.assertFalse(access.visible(CALLER, {"scope": "project", "tenant_id": "fourfourone", "project_id": "oman-pilot"}))
        self.assertFalse(access.visible(CALLER, {"scope": "tenant", "tenant_id": "verdant"}))
        self.assertFalse(access.visible(CALLER, {"scope": "shared", "tenant_id": "verdant"}))
        self.assertFalse(access.visible(CALLER, {}))

    def test_key_scope(self):
        self.assertEqual(access.key_scope("tenants/fourfourone/projects/fujairah/monitoring-plan.pdf")["scope"], "project")
        self.assertEqual(access.key_scope("tenants/fourfourone/tenant/sop.pdf")["scope"], "tenant")
        self.assertEqual(access.key_scope("shared/puro/puro-gsc/2024-v5/methodology.pdf")["methodology"], "puro-gsc")
        for bad in (
            "tenants/fourfourone/projects/fujairah/x.pdf.metadata.json",
            "tenants/../verdant/tenant/x.pdf",
            "uploads/x.pdf",
            "tenants/Four#One/tenant/x.pdf",
            "shared/puro/x.pdf",
        ):
            with self.assertRaises(ValueError, msg=bad):
                access.key_scope(bad)

    def test_graph_rows_from_other_tenants_or_projects_are_dropped(self):
        def node(tenant, project=None):
            return {"~entityType": "node", "~properties": {"tenant_id": tenant, **({"project_id": project} if project else {})}}

        self.assertTrue(access.graph_row_visible(CALLER, {"path": [node("fourfourone", "fujairah"), node("fourfourone")]}))
        self.assertFalse(access.graph_row_visible(CALLER, {"path": [node("fourfourone"), node("verdant")]}))
        self.assertFalse(access.graph_row_visible(CALLER, {"path": [node("fourfourone", "oman-pilot")]}))


class SchemaTests(unittest.TestCase):
    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda", "sql", "001_cortex.sql")
        with open(path, encoding="utf-8") as handle:
            self.sql = handle.read()
        self.statements = migrate.statements(self.sql)

    def test_every_tenant_table_forces_row_level_security(self):
        for table in ("documents", "project_facts", "approvals"):
            self.assertIn(f"ALTER TABLE cortex.{table} ENABLE ROW LEVEL SECURITY", self.statements)
            self.assertIn(f"ALTER TABLE cortex.{table} FORCE ROW LEVEL SECURITY", self.statements)

    def test_policies_key_on_session_tenant(self):
        policies = [s for s in self.statements if s.startswith("CREATE POLICY")]
        self.assertGreaterEqual(len(policies), 6)
        for policy in policies:
            self.assertIn("cortex.current_tenant()", policy, policy)

    def test_hybrid_search_and_metadata_indexes_exist(self):
        self.assertIn("to_tsvector('simple', chunks)", self.sql)
        self.assertIn("USING gin (custom_metadata)", self.sql)
        self.assertIn("vector(1024)", self.sql)

    def test_statements_split_cleanly(self):
        self.assertTrue(all(not s.startswith("--") for s in self.statements))
        self.assertTrue(any(s.startswith("CREATE OR REPLACE FUNCTION cortex.current_projects") for s in self.statements))


if __name__ == "__main__":
    unittest.main()
