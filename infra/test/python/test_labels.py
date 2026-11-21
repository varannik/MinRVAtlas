"""What a document is, where it belongs and whether Cortex holds it (no AWS needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import labels  # noqa: E402

PROJECT_KEY = "tenants/fourfourone/projects/fujairah-mineral/knowledge/General_Rules_4_4.pdf"
ORG_KEY = "tenants/fourfourone/tenant/protocols/General_Rules.pdf"
SHARED_KEY = "shared/puro/puro-geologically-stored-carbon/2024-v5/Geologically_Stored_Carbon_2024_5.pdf"
FUJAIRAH = {"registry": "puro", "methodology": "puro-geologically-stored-carbon", "edition": "2024-v5"}


def answer(**fields):
    return {"title": "", "issuer": "", "version": "", "summary": "s", "kind": "registry_rules", "reason": "r", **fields}


def labelled(key, **fields):
    return {**labels.label_from(answer(**fields)), "key": key}


RULES = labelled(ORG_KEY, title="Puro Standard General Rules", issuer="Puro.earth", version="Version 4.4")


class PlaceTest(unittest.TestCase):
    def test_project_document(self):
        place = labels.place_of(PROJECT_KEY)
        self.assertEqual((place["scope"], place["project_id"], place["pin"]), ("project", "fujairah-mineral", "knowledge"))
        self.assertEqual(place["name"], "General_Rules_4_4.pdf")

    def test_organisation_document(self):
        place = labels.place_of(ORG_KEY)
        self.assertEqual((place["scope"], place["tenant_id"], place["pin"]), ("tenant", "fourfourone", "protocols"))

    def test_registry_document_has_no_pin(self):
        place = labels.place_of(SHARED_KEY)
        self.assertEqual((place["scope"], place["pin"], place["name"]), ("shared", None, "Geologically_Stored_Carbon_2024_5.pdf"))

    def test_a_project_document_is_compared_with_its_project_organisation_and_registry(self):
        self.assertEqual(
            labels.neighbour_prefixes(labels.place_of(PROJECT_KEY)),
            [
                "labels/tenants/fourfourone/projects/fujairah-mineral/",
                "labels/tenants/fourfourone/tenant/",
                "labels/shared/",
            ],
        )

    def test_an_organisation_document_is_not_held_back_by_one_projects_copy(self):
        self.assertEqual(
            labels.neighbour_prefixes(labels.place_of(ORG_KEY)), ["labels/tenants/fourfourone/tenant/", "labels/shared/"]
        )

    def test_registry_documents_the_project_searches(self):
        self.assertTrue(labels.searches_shared(FUJAIRAH, SHARED_KEY))
        self.assertTrue(labels.searches_shared(FUJAIRAH, "shared/puro/any/any/General_Rules.pdf"))
        self.assertFalse(labels.searches_shared(FUJAIRAH, "shared/puro/puro-biochar/2024-v1/Biochar.pdf"))

    def test_label_file_key_round_trip(self):
        self.assertEqual(labels.document_key(labels.label_key(PROJECT_KEY)), PROJECT_KEY)


class ExcerptTest(unittest.TestCase):
    def test_reads_in_page_order_with_each_running_header_once(self):
        elements = [
            {"type": "TEXT", "page_indices": [1], "reading_order": 0, "representation": {"text": "1 Introduction"}},
            {"type": "HEADER", "page_indices": [0], "reading_order": 0, "representation": {"text": "Puro.earth"}},
            {"type": "TITLE", "page_indices": [0], "reading_order": 1, "representation": {"text": "General Rules"}},
            {"type": "HEADER", "page_indices": [1], "reading_order": 0, "representation": {"text": "Puro.earth"}},
            {"type": "PAGE_NUMBER", "page_indices": [1], "reading_order": 9, "representation": {"text": "2"}},
        ]
        text, pages = labels.excerpt(elements)
        self.assertEqual(text, "Puro.earth\n\nGeneral Rules\n\n1 Introduction")
        self.assertEqual(pages, 2)

    def test_stops_at_the_limit(self):
        elements = [{"type": "TEXT", "page_indices": [i], "representation": {"text": f"{i:03d}" + "x" * 97}} for i in range(50)]
        text, pages = labels.excerpt(elements, limit=250)
        self.assertEqual(len(text), 250)
        self.assertEqual(pages, 50)

    def test_prompt_names_the_file_and_methodology_but_not_the_pin(self):
        text = labels.prompt(labels.place_of(PROJECT_KEY), FUJAIRAH, "General Rules", 40)
        self.assertIn("File name: General_Rules_4_4.pdf", text)
        self.assertIn("puro puro-geologically-stored-carbon 2024-v5", text)
        self.assertIn("<document>\nGeneral Rules\n</document>", text)
        self.assertNotIn("knowledge", text)


class LabelTest(unittest.TestCase):
    def test_kind_gives_the_pin_and_reach(self):
        self.assertEqual((RULES["pin"], RULES["applies_to"]), ("protocols", "every_project"))
        evidence = labels.label_from(answer(kind="evidence"))
        self.assertEqual((evidence["pin"], evidence["applies_to"]), ("evidence", "one_project"))
        unrelated = labels.label_from(answer(kind="not_mrv"))
        self.assertEqual((unrelated["pin"], unrelated["applies_to"]), (None, None))

    def test_unknown_kind_is_no_label(self):
        with self.assertRaises(labels.Unlabelled):
            labels.label_from(answer(kind="poem"))

    def test_fields_are_trimmed(self):
        label = labels.label_from(answer(title="  General\n  Rules ", summary="x" * 900))
        self.assertEqual(label["title"], "General Rules")
        self.assertEqual(len(label["summary"]), labels.MAX_FIELD_CHARS["summary"])

    def test_versions_written_differently_are_one_version(self):
        self.assertEqual({labels.version_key(v) for v in ("Version 4.4", "v4.4", "4.4", "V. 4.4")}, {"4.4"})
        self.assertEqual({labels.version_key(v) for v in ("2024-v5", "2024 v5", "2024 V5")}, {"2024.5"})
        self.assertNotEqual(labels.version_key("4.3"), labels.version_key("4.4"))

    def test_title_without_its_version(self):
        self.assertEqual(labels.title_key("Puro Standard General Rules, Version 4.4", "4.4"), "puro standard general rules")
        self.assertEqual(labels.title_key("Puro Standard General Rules v4.4", "v4.4"), "puro standard general rules")


class SameDocumentTest(unittest.TestCase):
    def test_same_title_and_version(self):
        copy = labelled(PROJECT_KEY, title="Puro Standard General Rules, Version 4.4", issuer="Puro.earth", version="4.4")
        self.assertTrue(labels.same_document(copy, RULES))

    def test_another_edition_is_not_the_same_document(self):
        older = labelled(PROJECT_KEY, title="Puro Standard General Rules", issuer="Puro.earth", version="4.3")
        self.assertFalse(labels.same_document(older, RULES))

    def test_no_version_is_never_enough(self):
        a = labelled(PROJECT_KEY, title="Sampling procedure", kind="organisation_procedure")
        b = labelled(ORG_KEY, title="Sampling procedure", kind="organisation_procedure")
        self.assertFalse(labels.same_document(a, b))

    def test_evidence_is_never_matched_on_its_title(self):
        a = labelled(PROJECT_KEY, title="Certificate of Analysis", version="1", kind="evidence")
        b = labelled(ORG_KEY, title="Certificate of Analysis", version="1", kind="evidence")
        self.assertFalse(labels.same_document(a, b))

    def test_different_issuers(self):
        other = labelled(PROJECT_KEY, title="Puro Standard General Rules", issuer="Someone Else", version="4.4")
        self.assertFalse(labels.same_document(other, RULES))
        unnamed = labelled(PROJECT_KEY, title="Puro Standard General Rules", version="4.4")
        self.assertTrue(labels.same_document(unnamed, RULES))


class HoldTest(unittest.TestCase):
    place = labels.place_of(PROJECT_KEY)
    copy = labelled(PROJECT_KEY, title="Puro Standard General Rules", issuer="Puro.earth", version="4.4")

    def test_not_mrv_material_is_held(self):
        self.assertEqual(labels.hold(labels.label_from(answer(kind="not_mrv")), self.place, []), ("not_mrv", None))

    def test_the_same_document_as_one_already_searched_is_held(self):
        held, same_as = labels.hold(self.copy, self.place, [RULES])
        self.assertEqual(held, "same_as")
        self.assertEqual(same_as["key"], ORG_KEY)

    def test_a_held_neighbour_does_not_hold_another(self):
        self.assertEqual(labels.hold(self.copy, self.place, [{**RULES, "held": "same_as"}]), (None, None))
        released = {**RULES, "held": "same_as", "released": {"by": "sub-1"}}
        self.assertEqual(labels.hold(self.copy, self.place, [released])[0], "same_as")

    def test_its_own_earlier_label_is_not_a_neighbour(self):
        self.assertEqual(labels.hold(self.copy, self.place, [{**self.copy}]), (None, None))

    def test_registry_and_unlabelled_documents_are_never_held(self):
        unrelated = labels.label_from(answer(kind="not_mrv"))
        self.assertEqual(labels.hold(unrelated, labels.place_of(SHARED_KEY), []), (None, None))
        self.assertEqual(labels.hold({"checked": False}, self.place, [RULES]), (None, None))


class RecordTest(unittest.TestCase):
    document = {"key": PROJECT_KEY, "doc_id": "doc-1"}
    place = labels.place_of(PROJECT_KEY)
    unrelated = labels.label_from(answer(kind="not_mrv"))

    def build(self, label, previous):
        return labels.record(self.document, self.place, label, previous, [], "haiku", "2026-11-21T10:00:00+00:00")

    def test_keep_in_cortex_stands_for_the_same_file(self):
        previous = {"doc_id": "doc-1", "held": "not_mrv", "released": {"by": "sub-1"}}
        record = self.build(self.unrelated, previous)
        self.assertEqual(record["held"], "not_mrv")
        self.assertFalse(labels.held_now(record))

    def test_a_new_file_at_the_same_name_is_held_again(self):
        previous = {"doc_id": "doc-0", "held": "not_mrv", "released": {"by": "sub-1"}}
        self.assertTrue(labels.held_now(self.build(self.unrelated, previous)))

    def test_keep_here_stands_while_the_suggestion_is_the_same(self):
        previous = {"pin": "protocols", "applies_to": "every_project", "placement_kept": {"by": "sub-1"}}
        self.assertEqual(self.build(RULES, previous)["placement_kept"], {"by": "sub-1"})
        evidence = labels.label_from(answer(kind="evidence"))
        self.assertIsNone(self.build(evidence, previous)["placement_kept"])

    def test_record_names_the_document_and_model(self):
        record = self.build(RULES, None)
        self.assertEqual((record["key"], record["doc_id"], record["model"]), (PROJECT_KEY, "doc-1", "haiku"))
        self.assertIsNone(record["held"])


if __name__ == "__main__":
    unittest.main()
