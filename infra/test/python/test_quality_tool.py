"""The quality tool: what Cortex reads about a project's data quality (no AWS needed)."""

import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import access  # noqa: E402
import quality_tool  # noqa: E402

CALLER = {"tenant_id": "fourfourone", "sub": "s1", "role": "operator", "project_ids": ["fujairah-mineral"], "project_id": "fujairah-mineral"}


def run(run_id, status, result=None):
    item = {"runId": {"S": run_id}, "status": {"S": status}, "finishedAt": {"S": "2026-11-24T10:01:00Z"}, "source": {"S": "seeded"}}
    if result:
        item["result"] = {"S": json.dumps(result)}
    return item


def finding(fid, severity, start, end, blocking, status="open", advisory=False):
    return {
        "finding": {
            "S": json.dumps(
                {
                    "id": fid,
                    "severity": severity,
                    "status": status,
                    "blocking": blocking,
                    "advisory": advisory,
                    "kind": "missing_days",
                    "metric": None,
                    "start": start,
                    "end": end,
                    "text": {"headline": f"Headline {fid}", "saw": "Saw.", "matters": "Matters.", "todo": "Do this.", "how": "Method."},
                }
            )
        }
    }


RESULT = {"range": {"start": "2025-01-01", "end": "2026-11-21"}, "counts": {"blocks": 1, "look": 1, "info": 0, "dismissed": 0}, "versions": {"engine": "0.1.0"}}
RUNS = [run("20261124T100000Z-bbbb", "running"), run("20261124T090000Z-aaaa", "done", RESULT)]
FINDINGS = [
    finding("F-1", "blocks", "2026-02-18", "2026-02-20", True),
    finding("F-2", "look", "2026-05-01", "2026-05-01", False, advisory=True),
]


class DescribeTest(unittest.TestCase):
    def test_not_checked_yet(self):
        answer = quality_tool.describe([run("20261124T100000Z-bbbb", "running")], [])
        self.assertFalse(answer["checked"])
        self.assertIn("One is running now.", answer["message"])

    def test_latest_finished_run_and_its_words(self):
        answer = quality_tool.describe(RUNS, FINDINGS)
        self.assertTrue(answer["running"])
        self.assertEqual(answer["run"]["id"], "20261124T090000Z-aaaa")
        self.assertEqual(answer["verdict"], "blocked")
        self.assertEqual(answer["findings"][0]["headline"], "Headline F-1")
        self.assertNotIn("how", answer["findings"][0])

    def test_verdict_for_a_period(self):
        answer = quality_tool.describe(RUNS, FINDINGS, start="2026-04-01", end="2026-06-30")
        self.assertEqual(answer["verdict"], "needs_look")
        self.assertEqual([f["id"] for f in answer["findings"]], ["F-2"])

    def test_by_severity(self):
        answer = quality_tool.describe(RUNS, FINDINGS, severity="blocks")
        self.assertEqual(answer["matching"], 1)


class AccessTest(unittest.TestCase):
    def test_only_a_granted_project(self):
        with self.assertRaises(access.Denied):
            quality_tool.findings({}, {**CALLER, "project_id": "other"})

    def test_dates_are_checked(self):
        self.assertIn("error", quality_tool.findings({"from": "last week"}, CALLER))

    def test_reads_the_callers_partition(self):
        seen = []

        def query(**kwargs):
            seen.append(kwargs["ExpressionAttributeValues"][":pk"]["S"])
            prefix = kwargs["ExpressionAttributeValues"][":prefix"]["S"]
            return {"Items": RUNS if prefix == "RUN#" else FINDINGS}

        fake = mock.Mock()
        fake.query.side_effect = query
        with mock.patch.object(quality_tool, "_dynamodb", fake), mock.patch.dict(os.environ, {"QUALITY_TABLE": "q"}):
            answer = quality_tool.findings({}, CALLER)
        self.assertEqual(set(seen), {"TENANT#fourfourone#PROJECT#fujairah-mineral"})
        self.assertEqual(answer["verdict"], "blocked")


if __name__ == "__main__":
    unittest.main()
