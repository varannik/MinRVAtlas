from cortex_agent import knowledge

from .fakes import PASSAGE


def test_a_passage_becomes_a_citation_with_its_file_name():
    [(source, text)] = knowledge.sources_from([PASSAGE])
    assert source["document"] == "Geologically_Stored_Carbon_2024_5.pdf"
    assert (source["clause_ref"], source["section"], source["page"], source["scope"]) == (
        "2.2.2",
        "2.2 Crediting period",
        13,
        "shared",
    )
    assert source["id"] == "doc-gsc#2.2.2#13"
    assert text.startswith("2.2.2 The crediting period")
    # The browser gets the file name, never the bucket.
    assert "s3://" not in str(source)


def test_the_model_reads_numbered_passages_with_their_citation():
    found = knowledge.sources_from([PASSAGE, {**PASSAGE, "clause_ref": None, "page": None, "scope": "project"}])
    body = knowledge.tool_text("crediting period", found)
    assert body.startswith("[1] Rule 2.2.2 · 2.2 Crediting period · Geologically_Stored_Carbon_2024_5.pdf, p. 13 · registry document\n")
    assert "[2] No rule number · 2.2 Crediting period · Geologically_Stored_Carbon_2024_5.pdf · project document" in body


def test_long_passages_are_shortened_for_the_model():
    found = knowledge.sources_from([{**PASSAGE, "text": "x" * 5000}])
    assert len(knowledge.tool_text("q", found)) < 2600


def test_no_passages_says_so():
    assert knowledge.tool_text("orbital storage", []).startswith('No passages matched "orbital storage"')


def test_cited_finds_rule_numbers_the_answer_quotes():
    sources = [source for source, _ in knowledge.sources_from([PASSAGE, {**PASSAGE, "clause_ref": "3.2.6", "doc_id": "d2"}])]
    answer = "The crediting period is 15 years (Rule 2.2.2, Geologically_Stored_Carbon_2024_5.pdf, p. 13), under version 4.4."
    assert knowledge.cited(answer, sources) == ["doc-gsc#2.2.2#13"]


def test_a_longer_number_is_not_mistaken_for_a_rule():
    sources = [source for source, _ in knowledge.sources_from([PASSAGE])]
    assert knowledge.cited("See rule 2.2.2.1 and figure 12.2.24.", sources) == []
