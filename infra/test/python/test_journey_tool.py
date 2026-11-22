"""The journey tool: what Cortex reads about where a project stands (no AWS needed)."""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import journey_tool  # noqa: E402

CALLER = {"tenant_id": "fourfourone", "sub": "s1", "role": "operator", "project_ids": ["fujairah-mineral"], "project_id": "fujairah-mineral"}

SUMMARY = {
    "definition": "2026-11-16",
    "registry": "Puro.earth",
    "methodology": "Geologically Stored Carbon Edition 2024 v5",
    "current": "monitor",
    "periods_closed": 0,
    "steps": [
        {
            "id": "setup", "label": "Project setup", "phase": "validation", "place": "done", "gate": "g", "done": 3, "total": 3, "flagged": 0,
            "tasks": [{"id": "setup.name", "label": "Facility name", "kind": "question", "status": "done", "answer": "Fujairah"}],
        },
        {
            "id": "package", "label": "Project documents", "phase": "validation", "place": "done", "gate": "g", "done": 9, "total": 10, "flagged": 1,
            "tasks": [{"id": "package.lca", "label": "LCA", "kind": "document", "status": "flagged", "note": "Amortisation is 10 years; v5 needs 15 or 20."}],
        },
        {
            "id": "monitor", "label": "Monitor", "phase": "verification", "place": "current", "gate": "Every measurement in.", "done": 1, "total": 3, "flagged": 0,
            "tasks": [
                {"id": "monitor.period", "label": "Period dates", "kind": "question", "status": "done", "answer": "1 Jan 2026 – 30 Jun 2026"},
                {"id": "monitor.injected", "label": "CO₂ injected", "kind": "question", "status": "open", "blocks": True},
                {"id": "monitor.calibration", "label": "Calibration", "kind": "document", "status": "open", "files": []},
                {"id": "monitor.reversal", "label": "Reversals", "kind": "question", "status": "open", "optional": True},
            ],
        },
    ],
}

ITEM = {"summary": {"S": json.dumps(SUMMARY)}, "version": {"N": "12"}, "updatedAt": {"S": "2026-11-22T10:00:00Z"}}


class DescribeTest(unittest.TestCase):
    def test_nothing_saved(self):
        self.assertFalse(journey_tool.describe(None)["saved"])
        self.assertFalse(journey_tool.describe({"version": {"N": "1"}})["saved"])

    def test_overview_names_the_current_step_what_it_still_needs_and_every_flag(self):
        answer = journey_tool.describe(ITEM)
        self.assertEqual((answer["saved"], answer["version"], answer["registry"]), (True, 12, "Puro.earth"))
        self.assertEqual(answer["current_step"]["id"], "monitor")
        self.assertEqual([task["id"] for task in answer["left_in_current_step"]], ["monitor.injected", "monitor.calibration"])
        self.assertEqual(answer["left_in_current_step"][0]["blocks"], True)
        self.assertEqual(answer["flagged"], [{"id": "package.lca", "label": "LCA", "status": "flagged", "note": SUMMARY["steps"][1]["tasks"][0]["note"], "step": "Project documents"}])
        self.assertEqual([(s["id"], s["done"], s["total"]) for s in answer["steps"]], [("setup", 3, 3), ("package", 9, 10), ("monitor", 1, 3)])
        self.assertNotIn("tasks", answer["steps"][0])

    def test_a_step_in_full_by_id_or_name(self):
        for wanted in ("package", "Project documents", "project DOCUMENTS"):
            with self.subTest(wanted=wanted):
                self.assertEqual(journey_tool.describe(ITEM, wanted)["step"]["tasks"][0]["id"], "package.lca")

    def test_an_unknown_step_lists_the_steps(self):
        answer = journey_tool.describe(ITEM, "audit")
        self.assertIn("monitor (Monitor)", answer["error"])


class HandlerTest(unittest.TestCase):
    def setUp(self):
        self.client = mock.Mock()
        self.client.get_item.return_value = {"Item": ITEM}
        patches = [mock.patch.object(journey_tool, "_dynamodb", self.client), mock.patch.dict(os.environ, {"JOURNEY_TABLE": "journeys"})]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def call(self, event):
        context = SimpleNamespace(client_context=SimpleNamespace(custom={"bedrockAgentCoreToolName": "journey___status"}))
        return journey_tool.handler(event, context)

    def test_reads_only_the_callers_project_item(self):
        answer = self.call({"caller": CALLER, "project_id": "fujairah-mineral"})
        self.assertTrue(answer["saved"])
        request = self.client.get_item.call_args.kwargs
        self.assertEqual(request["Key"], {"pk": {"S": "TENANT#fourfourone#PROJECT#fujairah-mineral"}, "sk": {"S": "JOURNEY"}})
        self.assertEqual(request["TableName"], "journeys")

    def test_needs_a_project_and_the_gateway(self):
        self.assertIn("project_id", self.call({"caller": {**CALLER, "project_id": None}})["error"])
        self.assertIn("gateway", self.call({"project_id": "fujairah-mineral"})["error"])
        self.assertIn("no access", self.call({"caller": {**CALLER, "project_ids": []}})["error"])
        self.client.get_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
