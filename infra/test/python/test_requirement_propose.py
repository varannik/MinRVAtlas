"""Registry value proposals: Cortex quotes the rules or proposes nothing (no AWS needed)."""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import requirement_propose  # noqa: E402

SCOPE = {"registry": "puro", "methodology": "puro-geologically-stored-carbon", "edition": "2024-v5"}
REQUIREMENT = {
    "id": "puro.crediting_period_years",
    "label": "Crediting period",
    "unit": "years",
    "question": "How many years does a production facility's crediting period last?",
    "search": "crediting period years",
}
PASSAGE = {
    "content": {"text": "2.2.2 The Crediting Period is 15 years from the first date of the first monitoring period. It may be renewed twice."},
    "metadata": {"scope": "shared", "clause_ref": "2.2.2", "page": 13.0, "source_key": "shared/puro/puro-geologically-stored-carbon/2024-v5/Geologically_Stored_Carbon_2024_5.pdf"},
}
EVENT = {"pk": "REQ#puro#puro-geologically-stored-carbon#2024-v5", "scope": SCOPE, "requirement": REQUIREMENT, "run": "run-1", "requested_by": "sub-1"}
ENV = {"KNOWLEDGE_BASE_ID": "KB1", "REQUIREMENTS_TABLE": "requirements", "PROPOSE_MODEL": "eu.anthropic.claude-sonnet-4-6", "AWS_REGION": "eu-west-2"}


def answer(**fields):
    base = {"found": True, "value": 15, "passage": 1, "quote": "The Crediting Period is 15 years", "clause_ref": "2.2.2", "confidence": "high", "note": ""}
    return {**base, **fields}


class FakeClaude:
    def __init__(self, reply):
        self.reply, self.calls = reply, []
        self.messages = self

    def create(self, **request):
        self.calls.append(request)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(self.reply))], usage=SimpleNamespace(input_tokens=900, output_tokens=60))


class ProposeTest(unittest.TestCase):
    def run_with(self, results, reply):
        agent = mock.Mock()
        agent.retrieve.return_value = {"retrievalResults": results}
        dynamodb = mock.Mock()
        claude = FakeClaude(reply)
        with mock.patch.dict(os.environ, ENV), mock.patch.object(requirement_propose, "_agent", agent), mock.patch.object(
            requirement_propose, "_dynamodb", dynamodb
        ), mock.patch.object(requirement_propose, "_claude", claude):
            result = requirement_propose.handler(EVENT, None)
        item = dynamodb.put_item.call_args.kwargs["Item"] if dynamodb.put_item.called else None
        return result, item, agent, claude

    def test_proposes_a_value_quoted_from_the_rules(self):
        result, item, agent, claude = self.run_with([PASSAGE], answer())
        self.assertEqual(result, {"requirement": REQUIREMENT["id"], "status": "proposed"})
        self.assertEqual((item["value"]["N"], item["clause_ref"]["S"], item["page"]["N"]), ("15", "2.2.2", "13"))
        self.assertEqual(item["document"]["S"], "Geologically_Stored_Carbon_2024_5.pdf")
        self.assertTrue(item["sk"]["S"].startswith("PROPOSAL#puro.crediting_period_years#"))
        self.assertEqual(item["pk"]["S"], EVENT["pk"])
        # Only this edition's registry documents (and those for any) are searched.
        search = agent.retrieve.call_args.kwargs["retrievalConfiguration"]["vectorSearchConfiguration"]["filter"]
        self.assertEqual(search, requirement_propose.registry_filter(SCOPE))
        self.assertIn({"in": {"key": "edition", "value": ["2024-v5", "any"]}}, search["andAll"])
        request = claude.calls[0]
        self.assertEqual(request["output_config"]["format"]["schema"], requirement_propose.SCHEMA)
        self.assertIn('<passage number="1"', request["messages"][0]["content"])

    def test_a_quote_that_is_not_in_the_passage_is_not_proposed(self):
        result, item, _, _ = self.run_with([PASSAGE], answer(quote="The Crediting Period is 20 years"))
        self.assertEqual(result["status"], "not_found")
        self.assertNotIn("value", item)
        self.assertIn("quote is not in the passage", item["note"]["S"])

    def test_a_passage_that_was_not_given_is_not_cited(self):
        self.assertEqual(self.run_with([PASSAGE], answer(passage=3))[0]["status"], "not_found")

    def test_nothing_found_says_why(self):
        result, item, _, _ = self.run_with([PASSAGE], answer(found=False, value=0, passage=0, quote="", note="Two passages disagree."))
        self.assertEqual(result["status"], "not_found")
        self.assertEqual(item["note"]["S"], "Two passages disagree.")

    def test_no_registry_documents_means_no_question_to_claude(self):
        result, item, _, claude = self.run_with([], answer())
        self.assertEqual(result["status"], "not_found")
        self.assertEqual(claude.calls, [])
        self.assertIn("No registry document", item["note"]["S"])

    def test_only_registry_passages_are_read(self):
        tenant = {**PASSAGE, "metadata": {**PASSAGE["metadata"], "scope": "tenant"}}
        _, item, _, claude = self.run_with([tenant], answer())
        self.assertEqual(claude.calls, [])
        self.assertEqual(item["status"]["S"], "not_found")


class VerifiedTest(unittest.TestCase):
    found = [{"text": "Section 4. The margin shall be at least 5 bar above the bubble point pressure."}]

    def test_whitespace_and_case_do_not_matter(self):
        self.assertIsNone(requirement_propose.verified(answer(quote="the margin shall be at least\n5 bar"), self.found))

    def test_values_must_be_usable_numbers(self):
        for value in (-1, float("inf"), True, "5"):
            with self.subTest(value=value):
                self.assertIsNotNone(requirement_propose.verified(answer(value=value, quote="at least 5 bar above"), self.found))

    def test_a_very_short_quote_is_not_enough(self):
        self.assertIsNotNone(requirement_propose.verified(answer(quote="5 bar"), self.found))


if __name__ == "__main__":
    unittest.main()
