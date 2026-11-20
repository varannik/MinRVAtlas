"""Search results: what the model reads, and the sources the person sees.

knowledge___search returns rule passages, each with the rule number, section
and page it comes from (infra/lib/cortex/lambda/knowledge_tool.py). The model
gets them numbered with that citation in front; the browser gets the same
citations so it can show where an answer came from.
"""

import re
from typing import TypedDict

# Long enough for a whole rule passage in most methodologies; the index splits longer ones.
MAX_PASSAGE_CHARS = 2400
EXCERPT_CHARS = 280
TOP_K = 6

# A rule or section number as answers write it: 3.2, 2.2.4 or 2.2.4.3. Only numbers that
# match a passage's clause_ref count, so a version (v4.4) or a quantity rarely matches.
RULE_REF = re.compile(r"(?<![\w.])(\d{1,2}(?:\.\d{1,3}){1,4})(?![\w]|\.\d)")

SCOPE_LABEL = {
    "shared": "registry document",
    "tenant": "your organisation's document",
    "project": "project document",
}


class Source(TypedDict):
    id: str
    document: str
    clause_ref: str | None
    section: str | None
    page: int | None
    scope: str | None
    excerpt: str


def _flat(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def document_name(source: str | None) -> str:
    """The file name from the passage's source (s3://bucket/tenants/…/name.pdf)."""
    name = (source or "").rstrip("/").rsplit("/", 1)[-1]
    return name or "document"


def _page(value) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and float(value).is_integer() and value > 0:
        return int(value)
    return None


def _text(value) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def sources_from(results: list[dict]) -> list[tuple[Source, str]]:
    """Each passage as a citation, with its full text for the model."""
    found: list[tuple[Source, str]] = []
    for hit in results or []:
        if not isinstance(hit, dict):
            continue
        text = (hit.get("text") or "").strip()
        document = document_name(hit.get("source"))
        clause = _text(hit.get("clause_ref"))
        page = _page(hit.get("page"))
        source: Source = {
            "id": f"{hit.get('doc_id') or document}#{clause or ''}#{page or ''}",
            "document": document,
            "clause_ref": clause,
            "section": _text(hit.get("section")),
            "page": page,
            "scope": _text(hit.get("scope")),
            "excerpt": _flat(text)[:EXCERPT_CHARS],
        }
        found.append((source, text))
    return found


def citation(source: Source) -> str:
    parts = [f"Rule {source['clause_ref']}" if source["clause_ref"] else "No rule number"]
    if source["section"]:
        parts.append(source["section"])
    parts.append(f"{source['document']}" + (f", p. {source['page']}" if source["page"] else ""))
    parts.append(SCOPE_LABEL.get(source["scope"] or "", "document"))
    return " · ".join(parts)


def tool_text(query: str, found: list[tuple[Source, str]]) -> str:
    """The search result as the model reads it."""
    if not found:
        return f'No passages matched "{query}". Try other words, or say the documents do not cover it.'
    blocks = []
    for number, (source, text) in enumerate(found, start=1):
        body = text if len(text) <= MAX_PASSAGE_CHARS else text[:MAX_PASSAGE_CHARS].rstrip() + " […]"
        blocks.append(f"[{number}] {citation(source)}\n{body}")
    return "\n\n".join(blocks)


def cited(answer: str, sources: list[Source]) -> list[str]:
    """Ids of the sources whose rule number the answer quotes."""
    refs = set(RULE_REF.findall(answer or ""))
    return [source["id"] for source in sources if source["clause_ref"] and source["clause_ref"] in refs]
