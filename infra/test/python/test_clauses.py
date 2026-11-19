"""Rule-by-rule passages from Bedrock Data Automation output (no AWS needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import clauses  # noqa: E402


def text(body, page, order, sub_type="PARAGRAPH", kind="TEXT", **extra):
    return {
        "type": kind,
        "sub_type": sub_type,
        "representation": {"markdown": body},
        "page_indices": [page - 1],
        "reading_order": order,
        **extra,
    }


# A slice of Puro GSC 2024 v5 as BDA lays it out, deliberately out of order.
ELEMENTS = [
    text("Edition 2024 v. 5", 13, 0, sub_type="HEADER"),
    text("13", 13, 99, sub_type="PAGE_NUMBER"),
    text("2.2.2 The Crediting Period in this methodology is 15 years starting from the first date "
         "of the first monitoring period (see rule 4.2.1).", 13, 3),
    text("## 2.2 Crediting Period", 13, 1, sub_type="SECTION_TITLE"),
    text("2.2.1 The CO2 Removal Supplier shall define the Production Facility, logistic chain, and storage site.",
         13, 2),
    text("It can be renewed twice by a new Production Facility Audit.", 13, 4),
    text("## 4.3 Overall equation", 30, 1, sub_type="SECTION_TITLE"),
    text("4.3.1 The overall number of CORCs (i.e. the total net amount of CO2 removed) during a monitoring "
         "period is calculated as follows:", 30, 2),
    text("CORCs = C_stored − E_project − E_leakage − E_reversal", 30, 3),
    text("| Variable | Unit |\n|---|---|\n| C_stored | tCO2 |", 30, 4, kind="TABLE"),
]


class PassagesTest(unittest.TestCase):
    def setUp(self):
        self.found = clauses.passages(ELEMENTS)
        self.by_ref = {p["clause_ref"]: p for p in self.found}

    def test_one_passage_per_rule_in_document_order(self):
        self.assertEqual([p["clause_ref"] for p in self.found], ["2.2.1", "2.2.2", "4.3.1"])

    def test_rule_text_runs_to_the_next_rule(self):
        passage = self.by_ref["2.2.2"]
        self.assertIn("15 years", passage["text"])
        self.assertIn("renewed twice", passage["text"])
        self.assertNotIn("4.3.1", passage["text"])

    def test_passages_carry_section_and_page(self):
        passage = self.by_ref["4.3.1"]
        self.assertEqual(passage["section"], "4.3 Overall equation")
        self.assertEqual(passage["page"], 30)
        self.assertTrue(passage["text"].startswith("Section 4.3 Overall equation"))
        self.assertIn("E_reversal", passage["text"])
        self.assertIn("| C_stored | tCO2 |", passage["text"])

    def test_headers_footers_and_page_numbers_are_dropped(self):
        everything = "\n".join(p["text"] for p in self.found)
        self.assertNotIn("Edition 2024 v. 5", everything)
        self.assertNotIn("\n13\n", everything)

    def test_text_before_a_sections_first_rule_is_cited_by_the_heading(self):
        found = clauses.passages(
            [
                text("## 4 Quantification of CO2 Removal Certificates (CORCs)", 29, 1, sub_type="SECTION_TITLE"),
                text("The amount of CO2 stored is converted to CO2 equivalents and credited as CORCs.", 29, 2),
                text("[Figure] Figure 3: The CORC calculation equation.", 29, 3, kind="FIGURE"),
            ]
        )
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["clause_ref"], "4")
        self.assertEqual(found[0]["section"], "4 Quantification of CO2 Removal Certificates (CORCs)")

    def test_numbers_inside_sentences_do_not_start_rules(self):
        found = clauses.passages(
            [
                text("2.3.1 The CORC is created when the CO2 has been injected.", 14, 1),
                text("Version 1.2.3 of the tool and 1,000 years of storage are mentioned here.", 14, 2),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["2.3.1"])

    def test_long_rules_are_split_into_parts(self):
        long_rule = "4.4.1 " + "\n\n".join("Sentence about stored carbon. " * 40 for _ in range(8))
        found = clauses.passages([text(long_rule, 31, 1)])
        self.assertGreater(len(found), 1)
        self.assertTrue(all(p["clause_ref"] == "4.4.1" for p in found))
        self.assertEqual([p["part"] for p in found], list(range(1, len(found) + 1)))
        self.assertTrue(all(len(p["text"]) <= clauses.MAX_CHARS for p in found))

    def test_margin_rule_numbers_label_the_paragraphs_that_follow(self):
        found = clauses.passages(
            [
                text("2.2 2.2.1 2.2.2 Production Facility and Crediting Period", 13, 1, sub_type="SECTION_TITLE"),
                text("The CO2 Removal Supplier shall define the Production Facility.", 13, 2),
                text("(a) All capture sites shall be similar in nature.", 13, 3, sub_type="LIST"),
                text("The Crediting Period in this methodology is 15 years starting from the first date of "
                     "the first monitoring period.", 13, 4),
                text("3.1.1", 15, 1),
                text("The CO2 Removal Supplier is responsible for the data trail.", 15, 2),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["2.2.1", "2.2.2", "3.1.1"])
        self.assertEqual(found[0]["section"], "2.2 Production Facility and Crediting Period")
        self.assertIn("(a) All capture sites", found[0]["text"])
        self.assertIn("15 years", found[1]["text"])
        self.assertIn("data trail", found[2]["text"])

    def test_list_items_hold_several_rules(self):
        # How BDA returned page 13 of Puro GSC 2024 v5: two rules in one list element.
        found = clauses.passages(
            [
                text("## 2.2 Production Facility and Crediting Period", 13, 1, sub_type="SECTION_HEADER"),
                text("- 2.2.1 The Production Facility is the ensemble of physical assets.\n"
                     "- (a) All capture sites shall be similar in nature.\n"
                     "- 2.2.2 The Crediting Period in this methodology is 15 years starting from the first date "
                     "of the first monitoring period (see rule 4.2.1).", 13, 2, sub_type="LIST"),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["2.2.1", "2.2.2"])
        self.assertIn("- (a) All capture sites", found[0]["text"])
        self.assertTrue(found[1]["text"].endswith("(see rule 4.2.1)."))
        self.assertIn("\n\n2.2.2 The Crediting Period", found[1]["text"])  # list mark dropped

    def test_margin_number_inside_a_sentence_starts_the_next_rule(self):
        # Page 30: the section number trails its heading and 4.3.1 lands mid-sentence.
        found = clauses.passages(
            [
                text("- 4.2.6 The CO2 Removal Supplier shall show the amount of CORCs (i.e. the total net amount "
                     "of CO2 removed, see rule 4.3.1) during a monitoring period.", 29, 1, sub_type="LIST"),
                text("## Overall equation 4.3", 30, 1, sub_type="SECTION_HEADER"),
                text("The overall number of CORCs (i.e. the total net amount of CO2 removed) during a 4.3.1 "
                     "monitoring period shall be calculated as follows:", 30, 2),
                text("(1) CORCs = Cstored - Eproject - Eleakage - Ereversal", 30, 3),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["4.2.6", "4.3.1"])
        rule = found[1]
        self.assertEqual(rule["section"], "4.3 Overall equation")
        self.assertIn("4.3.1 The overall number of CORCs (i.e. the total net amount of CO2 removed) during a "
                      "monitoring period", rule["text"])
        self.assertIn("Cstored", rule["text"])

    def test_references_to_other_rules_do_not_start_rules(self):
        found = clauses.passages(
            [
                text("4.4.6 The supplier shall quantify Fsupplier (see subrule 4.4.7 (a)), as in rules 4.4.7 and "
                     "4.4.8, and keep records 4.4.7) for every period.", 33, 1),
                text("This is an example of a numbered rule. The requirements set within 0.0.1 numbered rules "
                     "must be followed, and 4.9.2 is out of sequence.", 33, 2),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["4.4.6"])

    def test_heading_and_rule_inside_one_two_column_paragraph(self):
        found = clauses.passages(
            [
                text("2.2.2 The Crediting Period in this methodology is 15 years.", 13, 1),
                text("2.3\tPoint of creation\t\n2.3.1\tThe point of creation of the CO2 Removal Certificate is "
                     "the moment the CO2 Stream has been injected.", 14, 1),
            ]
        )
        self.assertEqual([p["clause_ref"] for p in found], ["2.2.2", "2.3.1"])
        self.assertEqual(found[1]["section"], "2.3 Point of creation")
        self.assertNotIn("Point of creation", found[0]["text"])

    def test_broken_words_are_joined_only_when_the_document_uses_the_word(self):
        found = clauses.passages(
            [
                text("3.3.1 Every operational site and its participants are named.", 20, 1),
                text("3.3.2 All storage sites shall be opera- tional, and par- ticipants listed, with activity- "
                     "shifting leakage assessed.", 20, 2),
            ]
        )
        self.assertIn("shall be operational, and participants listed", found[1]["text"])
        self.assertIn("activity- shifting", found[1]["text"])

    def test_logos_and_contents_are_left_out_and_front_matter_has_its_own_sections(self):
        found = clauses.passages(
            [
                text("# Contents", 2, 1, sub_type="TITLE"),
                text("| 4.3 Overall equation | 30 |\n| 4.4 Carbon dioxide stored | 31 |", 2, 2, kind="TABLE"),
                text("## Glossary", 4, 1, sub_type="SECTION_HEADER"),
                text("**CO2 Plume** The extent of an underground injected CO2 Stream, in three dimensions.", 4, 2),
                text("![LOGO](./logo.png)\n\npuroearth", 4, 3, kind="FIGURE", sub_type="LOGO"),
                text("## 1.1 Overview", 8, 1, sub_type="SECTION_HEADER"),
                text("This methodology sets the requirements for eligibility and quantification.", 8, 2),
                text("## EXAMPLE", 8, 3, sub_type="SECTION_HEADER"),
                text("A worked example of the quantification for one monitoring period.", 8, 4),
            ]
        )
        self.assertEqual([p["section"] for p in found], ["Glossary", "1.1 Overview"])
        everything = "\n".join(p["text"] for p in found)
        self.assertNotIn("puroearth", everything)
        self.assertNotIn("| 30 |", everything)
        self.assertIn("## EXAMPLE", found[1]["text"])  # an unnumbered header inside a section stays there

    def test_is_rule(self):
        self.assertTrue(clauses.is_rule("4.3.1"))
        self.assertFalse(clauses.is_rule("4.3"))
        self.assertFalse(clauses.is_rule(""))


if __name__ == "__main__":
    unittest.main()
