"""Passage files and citations for clause-chunked knowledge (no AWS needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import access  # noqa: E402
import ingest_chunk  # noqa: E402
import knowledge_tool  # noqa: E402

SHARED = {
    "doc_id": "d0d6ee95-7ae8-5627-b0b6-7b4e20d42d28",
    "key": "shared/puro/puro-geologically-stored-carbon/2024-v5/Geologically_Stored_Carbon_2024_5.pdf",
    "scope": "shared",
    "registry": "puro",
    "methodology": "puro-geologically-stored-carbon",
    "edition": "2024-v5",
}
PROJECT = {
    "doc_id": "a1",
    "key": "tenants/fourfourone/projects/fujairah-mineral/monitoring-plan.pdf",
    "scope": "project",
    "tenant_id": "fourfourone",
    "project_id": "fujairah-mineral",
}
PASSAGE = {"clause_ref": "4.3.1", "section": "4.3 Overall equation", "page": 30, "part": None, "text": "…"}


class ResultPathsTest(unittest.TestCase):
    def test_finds_every_standard_output_path(self):
        job = {
            "job_id": "x",
            "output_metadata": [
                {
                    "asset_id": 0,
                    "segment_metadata": [
                        {"standard_output_path": "s3://b/bda/1/0/standard_output/0/result.json"},
                        {"standard_output_path": "s3://b/bda/1/0/standard_output/1/result.json"},
                    ],
                }
            ],
        }
        self.assertEqual(
            list(ingest_chunk.result_paths(job)),
            ["s3://b/bda/1/0/standard_output/0/result.json", "s3://b/bda/1/0/standard_output/1/result.json"],
        )


class PassageMetadataTest(unittest.TestCase):
    def test_shared_passage_keeps_the_methodology_filter_and_cites_the_rule(self):
        attrs = ingest_chunk.passage_metadata(SHARED, PASSAGE, 7)["metadataAttributes"]
        self.assertEqual(attrs["scope"], "shared")
        self.assertEqual(attrs["methodology"], "puro-geologically-stored-carbon")
        self.assertEqual(attrs["edition"], "2024-v5")
        self.assertEqual(attrs["clause_ref"], "4.3.1")
        self.assertEqual(attrs["page"], 30)
        self.assertEqual(attrs["source_key"], SHARED["key"])
        self.assertNotIn("tenant_id", attrs)  # empty fields are left out
        self.assertNotIn("part", attrs)

    def test_passages_stay_visible_only_to_their_scope(self):
        shared = ingest_chunk.passage_metadata(SHARED, PASSAGE, 1)["metadataAttributes"]
        project = ingest_chunk.passage_metadata(PROJECT, PASSAGE, 1)["metadataAttributes"]
        member = {"tenant_id": "fourfourone", "project_ids": ["fujairah-mineral"], "project_id": "fujairah-mineral"}
        outsider = {"tenant_id": "someone-else", "project_ids": [], "project_id": None}
        self.assertTrue(access.visible(member, shared))
        self.assertTrue(access.visible(outsider, shared))
        self.assertTrue(access.visible(member, project))
        self.assertFalse(access.visible(outsider, project))


class SupersededTest(unittest.TestCase):
    """A run must not write passages for a document removed or replaced while it was parsed."""

    def test_current_document_is_written(self):
        self.assertIsNone(ingest_chunk.superseded(SHARED, {"doc_id": SHARED["doc_id"]}))

    def test_removed_document_is_not_written(self):
        self.assertIn("removed", ingest_chunk.superseded(SHARED, {}))

    def test_document_replaced_by_a_newer_upload_is_not_written(self):
        self.assertIn("newer upload", ingest_chunk.superseded(SHARED, {"doc_id": "a-newer-upload"}))


class CitationTest(unittest.TestCase):
    def test_cites_the_original_document_rule_and_page(self):
        os.environ["KNOWLEDGE_BUCKET"] = "knowledge-bucket"
        item = {
            "content": {"text": "4.3.1 The overall number of CORCs …"},
            "score": 0.61,
            "location": {"s3Location": {"uri": "s3://parsed/chunks/x/0042.md"}},
        }
        metadata = {**ingest_chunk.passage_metadata(SHARED, PASSAGE, 42)["metadataAttributes"], "page": 30.0}
        result = knowledge_tool.citation(item, metadata)
        self.assertEqual(result["source"], f"s3://knowledge-bucket/{SHARED['key']}")
        self.assertEqual(result["clause_ref"], "4.3.1")
        self.assertEqual(result["page"], 30)
        self.assertEqual(result["section"], "4.3 Overall equation")


if __name__ == "__main__":
    unittest.main()
