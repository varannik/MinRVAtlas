"""Labelling, held passages, decisions and moves, against an in-memory S3 (no AWS needed)."""

import json
import os
import sys
import unittest
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import ingest_chunk  # noqa: E402
import ingest_label  # noqa: E402
import ingest_move  # noqa: E402
import ingest_remove  # noqa: E402
import ingest_review  # noqa: E402
import labels  # noqa: E402
from fake_s3 import FakeS3  # noqa: E402

PARSED, KNOWLEDGE, INTAKE = "parsed", "knowledge", "intake"
KEY = "tenants/fourfourone/projects/fujairah-mineral/knowledge/General_Rules_copy.pdf"
ORG_KEY = "tenants/fourfourone/tenant/protocols/General_Rules_4_4.pdf"
JOB = "s3://parsed/bda/doc-1/job_metadata.json"
ENV = {
    "PARSED_BUCKET": PARSED,
    "KNOWLEDGE_BUCKET": KNOWLEDGE,
    "INTAKE_BUCKET": INTAKE,
    "LABEL_MODEL": "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    "AWS_REGION": "eu-west-2",
}
REQUEST = {"tenant_id": "fourfourone", "project_id": "fujairah-mineral", "requested_by": "sub-1"}


class FakeClaude:
    def __init__(self, answer=None, error=None):
        self.answer, self.error, self.calls = answer, error, []
        self.messages = self

    def create(self, **request):
        self.calls.append(request)
        if self.error:
            raise self.error
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="text", text=json.dumps(self.answer))],
            usage=SimpleNamespace(input_tokens=1200, output_tokens=80),
        )


def answer(kind="registry_rules", title="Puro Standard General Rules", version="4.4"):
    return {"title": title, "issuer": "Puro.earth", "version": version, "summary": "s", "kind": kind, "reason": "r"}


def parsed_document(s3, text="Puro Standard General Rules\nVersion 4.4"):
    s3.put(PARSED, "bda/doc-1/job_metadata.json", json.dumps({"output_metadata": [{"standard_output_path": "s3://parsed/bda/doc-1/0/result.json"}]}))
    elements = [{"type": "TITLE", "page_indices": [0], "representation": {"text": text}}]
    s3.put(PARSED, "bda/doc-1/0/result.json", json.dumps({"elements": elements}))


class Handlers(unittest.TestCase):
    def setUp(self):
        self.s3 = FakeS3()
        patches = [mock.patch.dict(os.environ, ENV)]
        for module in (ingest_chunk, ingest_label, ingest_move, ingest_remove, ingest_review):
            patches.append(mock.patch.object(module, "_s3", self.s3))
        patches.append(mock.patch.object(ingest_label.tenancy, "project", return_value={"methodology": "puro-geologically-stored-carbon"}))
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def label(self, claude, key=KEY):
        with mock.patch.object(ingest_label, "_claude", claude):
            return ingest_label.handler({"document": {"key": key, "doc_id": "doc-1"}, "jobMetadata": JOB}, None)

    def stored_label(self, key=KEY):
        return json.loads(self.s3.body(PARSED, labels.label_key(key)))


class LabelTaskTest(Handlers):
    def test_labels_a_document_and_asks_for_the_schema(self):
        parsed_document(self.s3)
        claude = FakeClaude(answer())
        result = self.label(claude)
        self.assertEqual(result, {"checked": True, "kind": "registry_rules", "held": None})
        label = self.stored_label()
        self.assertEqual((label["pin"], label["title"], label["version_key"]), ("protocols", "Puro Standard General Rules", "4.4"))
        request = claude.calls[0]
        self.assertEqual(request["model"], ENV["LABEL_MODEL"])
        self.assertEqual(request["output_config"]["format"]["schema"], labels.SCHEMA)
        self.assertIn("Puro Standard General Rules", request["messages"][0]["content"])

    def test_holds_material_that_is_not_mrv(self):
        parsed_document(self.s3, "Lunch menu")
        self.assertEqual(self.label(FakeClaude(answer(kind="not_mrv", title="Menu", version="")))["held"], "not_mrv")

    def test_holds_a_copy_of_a_document_the_organisation_already_gives_every_project(self):
        parsed_document(self.s3)
        organisation = {**labels.label_from(answer()), "key": ORG_KEY, "held": None}
        self.s3.put(PARSED, labels.label_key(ORG_KEY), json.dumps(organisation))
        self.assertEqual(self.label(FakeClaude(answer()))["held"], "same_as")
        self.assertEqual(self.stored_label()["same_as"]["key"], ORG_KEY)

    def test_another_edition_is_searched(self):
        parsed_document(self.s3)
        organisation = {**labels.label_from(answer(version="4.3")), "key": ORG_KEY, "held": None}
        self.s3.put(PARSED, labels.label_key(ORG_KEY), json.dumps(organisation))
        self.assertIsNone(self.label(FakeClaude(answer()))["held"])

    def test_when_claude_cannot_be_reached_the_document_is_searched_unlabelled(self):
        parsed_document(self.s3)
        result = self.label(FakeClaude(error=RuntimeError("AccessDeniedException")))
        self.assertEqual(result, {"checked": False, "kind": None, "held": None})
        self.assertFalse(self.stored_label()["checked"])


class ChunkAreaTest(unittest.TestCase):
    def test_held_passages_go_where_the_index_does_not_read(self):
        self.assertEqual(ingest_chunk.passage_area({"held": "not_mrv"}), "held")
        self.assertEqual(ingest_chunk.passage_area({"held": None}), "chunks")
        self.assertEqual(ingest_chunk.passage_area(None), "chunks")


class ReviewTaskTest(Handlers):
    def held(self):
        self.s3.put(PARSED, labels.label_key(KEY), json.dumps({"key": KEY, "doc_id": "doc-1", "held": "not_mrv", "pin": None}))
        for name in ("0001.md", "0001.md.metadata.json", "0002.md", "0002.md.metadata.json"):
            self.s3.put(PARSED, f"held/{KEY}/{name}", name)

    def test_keep_moves_held_passages_into_search(self):
        self.held()
        result = ingest_review.handler({**REQUEST, "key": KEY, "action": "keep"}, None)
        self.assertEqual((result["passages_released"], result["reindex"]), (2, True))
        self.assertEqual(self.s3.keys(PARSED, "held/"), [])
        self.assertEqual(len(self.s3.keys(PARSED, f"chunks/{KEY}/")), 4)
        self.assertEqual(self.stored_label()["released"]["by"], "sub-1")
        self.assertFalse(labels.held_now(self.stored_label()))

    def test_stay_records_that_the_suggestion_was_declined(self):
        self.s3.put(PARSED, labels.label_key(KEY), json.dumps({"key": KEY, "pin": "protocols", "held": None}))
        result = ingest_review.handler({**REQUEST, "key": KEY, "action": "stay"}, None)
        self.assertFalse(result["reindex"])
        self.assertEqual(self.stored_label()["placement_kept"]["by"], "sub-1")

    def test_keep_needs_a_held_document_and_a_known_decision(self):
        self.s3.put(PARSED, labels.label_key(KEY), json.dumps({"key": KEY, "held": None}))
        with self.assertRaises(ingest_review.NotAllowed):
            ingest_review.handler({**REQUEST, "key": KEY, "action": "keep"}, None)
        with self.assertRaises(ingest_review.NotAllowed):
            ingest_review.handler({**REQUEST, "key": KEY, "action": "delete"}, None)

    def test_never_another_project(self):
        self.held()
        with self.assertRaises(ingest_review.NotAllowed):
            ingest_review.handler({**REQUEST, "project_id": "oman-basalt", "key": KEY, "action": "keep"}, None)


class MoveTaskTest(Handlers):
    def test_copies_the_original_into_intake_at_its_new_place(self):
        self.s3.put(KNOWLEDGE, KEY, b"%PDF")
        target = "tenants/fourfourone/tenant/protocols/General_Rules_copy.pdf"
        result = ingest_move.handler({**REQUEST, "key": KEY, "to_key": target}, None)
        self.assertEqual((result["key"], result["to_key"]), (KEY, target))
        self.assertEqual(self.s3.body(INTAKE, target), b"%PDF")
        copy = self.s3.copies[0]
        self.assertEqual((copy["MetadataDirective"], copy["ChecksumAlgorithm"]), ("COPY", "SHA256"))

    def test_moves_to_another_pin_of_the_project(self):
        self.s3.put(KNOWLEDGE, KEY, b"%PDF")
        target = "tenants/fourfourone/projects/fujairah-mineral/protocols/General_Rules_copy.pdf"
        self.assertEqual(ingest_move.handler({**REQUEST, "key": KEY, "to_key": target}, None)["to_key"], target)

    def test_refuses_a_taken_name_a_renamed_file_and_a_project_only_pin(self):
        self.s3.put(KNOWLEDGE, KEY, b"%PDF")
        taken = "tenants/fourfourone/projects/fujairah-mineral/protocols/General_Rules_copy.pdf"
        self.s3.put(INTAKE, taken, b"other")
        for target in (
            taken,
            "tenants/fourfourone/projects/fujairah-mineral/protocols/Renamed.pdf",
            "tenants/fourfourone/tenant/evidence/General_Rules_copy.pdf",
            "tenants/fourfourone/projects/fujairah-mineral/datasets/General_Rules_copy.pdf",
            "tenants/someone-else/tenant/protocols/General_Rules_copy.pdf",
            KEY,
        ):
            with self.subTest(target=target), self.assertRaises(ingest_move.NotAllowed):
                ingest_move.handler({**REQUEST, "key": KEY, "to_key": target}, None)
        self.assertEqual(self.s3.copies, [])


class RemoveTaskTest(Handlers):
    def test_removes_held_passages_and_the_label_too(self):
        self.s3.put(KNOWLEDGE, KEY, b"%PDF")
        self.s3.put(PARSED, f"held/{KEY}/0001.md", "x")
        self.s3.put(PARSED, f"held/{KEY}/0001.md.metadata.json", "{}")
        self.s3.put(PARSED, labels.label_key(KEY), "{}")
        result = ingest_remove.handler({**REQUEST, "key": KEY}, None)
        self.assertEqual(result["passages_removed"], 1)
        self.assertEqual(self.s3.keys(PARSED), [])


if __name__ == "__main__":
    unittest.main()
