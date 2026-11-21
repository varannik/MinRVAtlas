"""Removal only ever touches the requesting project's or tenant's own documents (no AWS needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import ingest_remove  # noqa: E402

KEY = "tenants/fourfourone/projects/fujairah-mineral/evidence/Lab_certificate.pdf"
REQUEST = {"key": KEY, "tenant_id": "fourfourone", "project_id": "fujairah-mineral", "requested_by": "sub-1"}


class RemovalScopeTest(unittest.TestCase):
    def test_a_project_document_of_the_requesting_project(self):
        self.assertEqual(ingest_remove.check(REQUEST), KEY)

    def test_never_a_shared_methodology_document(self):
        shared = "shared/puro/puro-geologically-stored-carbon/2024-v5/Geologically_Stored_Carbon_2024_5.pdf"
        with self.assertRaises(ingest_remove.NotAllowed):
            ingest_remove.check({**REQUEST, "key": shared})

    def test_never_another_project_or_tenant(self):
        with self.assertRaises(ingest_remove.NotAllowed):
            ingest_remove.check({**REQUEST, "project_id": "oman-basalt"})
        with self.assertRaises(ingest_remove.NotAllowed):
            ingest_remove.check({**REQUEST, "tenant_id": "someone-else"})

    def test_an_organisation_document_of_the_requesting_tenant(self):
        own = "tenants/fourfourone/tenant/protocols/Sampling_SOP.pdf"
        self.assertEqual(ingest_remove.check({**REQUEST, "key": own}), own)

    def test_never_another_tenants_organisation_document(self):
        with self.assertRaises(ingest_remove.NotAllowed):
            ingest_remove.check({**REQUEST, "key": "tenants/someone-else/tenant/protocols/Sampling_SOP.pdf"})

    def test_never_a_metadata_file_or_a_folder(self):
        for key in (f"{KEY}.metadata.json", "tenants/fourfourone/projects/fujairah-mineral/evidence/", f"{KEY}/../x.pdf"):
            with self.assertRaises(ingest_remove.NotAllowed):
                ingest_remove.check({**REQUEST, "key": key})


if __name__ == "__main__":
    unittest.main()
