"""Evidence links: journey changes become graph statements, and the evidence tool reads them back (no AWS needed)."""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import graph_tool  # noqa: E402
import graph_writer  # noqa: E402

T, P = "fourfourone", "fujairah-mineral"
KYC = f"tenants/{T}/projects/{P}/evidence/kyc.pdf"
ORG = f"tenants/{T}/tenant/knowledge/KYB_policy.pdf"


def change(files, action="answer", version=7, task="onboarding.kyc"):
    image = {
        "pk": {"S": f"TENANT#{T}#PROJECT#{P}"},
        "sk": {"S": f"CHANGE#{version:08d}"},
        "action": {"S": action},
        "taskId": {"S": task},
        "label": {"S": "KYB / KYC"},
        "step": {"S": "onboarding"},
        "rule": {"S": "Puro CP 1.2 · KYC"},
        "version": {"N": str(version)},
        "by": {"S": "sub-1"},
        "at": {"S": "2026-11-22T10:00:00Z"},
    }
    if files is not None:
        image["files"] = {"S": json.dumps(files)}
    return image


class FilingTest(unittest.TestCase):
    def test_an_answer_with_documents_links_them_to_its_task(self):
        filed = graph_writer.filing(change([{"name": "kyc.pdf", "size": 1, "key": KYC}, {"name": "register.xlsx", "size": 1}]))
        self.assertEqual(filed["task_uid"], f"{T}#task#{P}#onboarding.kyc")
        self.assertEqual(filed["project_uid"], f"{T}#project#{P}")
        self.assertEqual(
            filed["documents"],
            [{"uid": f"{T}#document#{KYC}", "key": KYC, "name": "kyc.pdf", "scope": "project", "pin": "evidence", "project_id": P}],
        )
        self.assertEqual((filed["version"], filed["rule"], filed["by"]), (7, "Puro CP 1.2 · KYC", "sub-1"))

    def test_organisation_and_registry_documents_belong_to_no_one_project(self):
        filed = graph_writer.filing(change([{"name": "a", "size": 1, "key": ORG}, {"name": "b", "size": 1, "key": "shared/puro/any/any/b.pdf"}]))
        self.assertEqual([(d["scope"], d["project_id"]) for d in filed["documents"]], [("tenant", ""), ("shared", "")])
        self.assertTrue(all(d["uid"].startswith(f"{T}#document#") for d in filed["documents"]))

    def test_another_projects_or_tenants_document_is_never_linked(self):
        for key in (f"tenants/{T}/projects/oman-pilot/evidence/a.pdf", f"tenants/other/tenant/knowledge/a.pdf", f"tenants/{T}/projects/{P}/../x/a.pdf"):
            with self.subTest(key=key):
                self.assertEqual(graph_writer.filing(change([{"name": "a.pdf", "size": 1, "key": key}]))["documents"], [])

    def test_only_answers_that_carry_files_file_anything(self):
        self.assertIsNone(graph_writer.filing(change(None)))
        self.assertIsNone(graph_writer.filing(change([], action="accept")))
        self.assertIsNone(graph_writer.filing({"pk": {"S": "nonsense"}, "action": {"S": "answer"}, "files": {"S": "[]"}}))


class StatementsTest(unittest.TestCase):
    def test_task_then_links_then_close_what_was_replaced(self):
        filed = graph_writer.filing(change([{"name": "kyc.pdf", "size": 1, "key": KYC}]))
        queries = graph_writer.statements(filed)
        self.assertEqual([q for q, _ in queries], [graph_writer.TASK_AND_PROJECT, graph_writer.LINK_DOCUMENTS, graph_writer.CLOSE_REPLACED])
        task_params, link_params, close_params = (params for _, params in queries)
        self.assertEqual((task_params["tenant_id"], task_params["project_id"], task_params["label"]), (T, P, "KYB / KYC"))
        self.assertEqual(link_params["documents"][0]["key"], KYC)
        self.assertEqual(close_params["keep"], [f"{T}#document#{KYC}"])
        # Parameters must be plain JSON for Neptune.
        for _, params in queries:
            json.dumps(params)

    def test_files_taken_away_close_every_link(self):
        queries = graph_writer.statements(graph_writer.filing(change([])))
        self.assertEqual([q for q, _ in queries], [graph_writer.TASK_AND_PROJECT, graph_writer.CLOSE_REPLACED])
        self.assertEqual(queries[-1][1]["keep"], [])

    def test_no_statement_deletes_or_removes(self):
        for query in (graph_writer.TASK_AND_PROJECT, graph_writer.LINK_DOCUMENTS, graph_writer.CLOSE_REPLACED):
            self.assertNotRegex(query.upper(), r"\b(DELETE|REMOVE|DETACH)\b")

    def test_handler_runs_the_statements_for_a_journey_changed_event(self):
        fake = mock.Mock()
        with mock.patch.object(graph_writer, "_client", fake):
            result = graph_writer.handler({"detail": {"eventName": "INSERT", "dynamodb": {"NewImage": change([{"name": "kyc.pdf", "size": 1, "key": KYC}])}}}, None)
        self.assertEqual(result, {"linked": 1})
        self.assertEqual(fake.execute_open_cypher_query.call_count, 3)
        sent = json.loads(fake.execute_open_cypher_query.call_args_list[1].kwargs["parameters"])
        self.assertEqual(sent["documents"][0]["uid"], f"{T}#document#{KYC}")


CALLER = {"tenant_id": T, "sub": "s", "role": "operator", "project_ids": [P], "project_id": P}


def row(task="onboarding.kyc", key=KYC, name="kyc.pdf", open_=True, tenant=T, project=P, doc_tenant=T, doc_project=P, until=None):
    return {
        "tenant_id": tenant, "project_id": project, "task_id": task, "label": "KYB / KYC", "step": "onboarding", "rule": "r",
        "doc_tenant_id": doc_tenant if key else None, "doc_project_id": doc_project if key else None,
        "name": name if key else None, "key": key, "scope": "project" if key else None,
        "open": open_ if key else None, "since": "2026-11-20T00:00:00Z" if key else None, "until": until,
    }


class EvidenceTest(unittest.TestCase):
    def test_groups_open_and_replaced_documents_by_task(self):
        rows = [
            row(),
            row(key=f"tenants/{T}/projects/{P}/evidence/old.pdf", name="old.pdf", open_=False, until="2026-11-21T00:00:00Z"),
            row(task="package.permits", key=None),
        ]
        tasks = graph_tool.group_evidence(rows, CALLER, P)
        self.assertEqual([t["task_id"] for t in tasks], ["onboarding.kyc", "package.permits"])
        self.assertEqual([d["name"] for d in tasks[0]["documents"]], ["kyc.pdf"])
        self.assertEqual(tasks[0]["replaced"][0]["until"], "2026-11-21T00:00:00Z")
        self.assertEqual(tasks[1]["documents"], [])

    def test_for_one_document_only_the_tasks_it_is_filed_on(self):
        rows = [row(), row(task="package.operators", key=f"tenants/{T}/projects/{P}/evidence/contract.pdf", name="contract.pdf")]
        tasks = graph_tool.group_evidence(rows, CALLER, P, "KYC.pdf")
        self.assertEqual([t["task_id"] for t in tasks], ["onboarding.kyc"])

    def test_rows_outside_the_tenant_or_project_are_dropped(self):
        rows = [
            row(tenant="other"),
            row(project="oman-pilot"),
            row(doc_tenant="other"),
            row(doc_project="oman-pilot"),
            row(key=ORG, doc_project=""),
        ]
        tasks = graph_tool.group_evidence(rows, CALLER, P)
        self.assertEqual([d["key"] for t in tasks for d in t["documents"]], [ORG])

    def test_the_tool_reads_the_callers_project_only(self):
        fake = mock.Mock()
        fake.execute_open_cypher_query.return_value = {"results": [row()]}
        context = SimpleNamespace(client_context=SimpleNamespace(custom={"bedrockAgentCoreToolName": "graph___evidence"}))
        with mock.patch.object(graph_tool, "_client", fake):
            answer = graph_tool.handler({"caller": CALLER, "project_id": P, "task_id": "onboarding.kyc"}, context)
            denied = graph_tool.handler({"caller": {**CALLER, "project_ids": []}, "project_id": P}, context)
        self.assertEqual(answer["tasks"][0]["documents"][0]["key"], KYC)
        sent = json.loads(fake.execute_open_cypher_query.call_args.kwargs["parameters"])
        self.assertEqual(sent, {"project_uid": f"{T}#project#{P}", "task_id": "onboarding.kyc"})
        self.assertIn("no access", denied["error"])
        self.assertEqual(fake.execute_open_cypher_query.call_count, 1)


if __name__ == "__main__":
    unittest.main()
