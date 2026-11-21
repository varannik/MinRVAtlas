"""What a document is, where it belongs, and whether Cortex searches it.

Claude reads the opening of each admitted document and labels it: its kind,
title, issuer and version. From the kind Cortex derives the pin it belongs on
and whether it applies to every project; the web suggests a move when the
document was given somewhere else. Two labels hold a document out of search
until a person decides: not MRV material, or the same document (title and
version) as one its searchers already have. The model proposes; a person decides.

Pure functions only: the label Lambda (ingest_label.py) reads S3 and calls Claude
around them.
"""

import re

import access
import clauses

# Each kind: the pin it belongs on, and whether it applies to every project in an
# organisation or to one project. Pins are apps/web/src/lib/cortex/capabilities.ts.
KINDS = {
    "registry_rules": ("protocols", "every_project"),
    "organisation_procedure": ("knowledge", "every_project"),
    "reference": ("knowledge", "every_project"),
    "project_design": ("knowledge", "one_project"),
    "evidence": ("evidence", "one_project"),
    "calibration": ("calibration", "one_project"),
    "verifier_correspondence": ("reviewer", "one_project"),
    "not_mrv": (None, None),
}
# Kinds a title and version identify. Evidence is not one: every lab certificate is
# titled "Certificate of Analysis".
IDENTIFIED_BY_TITLE = frozenset({"registry_rules", "organisation_procedure", "reference", "project_design"})

EXCERPT_CHARS = 8000
# Shown to people as written, so kept short.
MAX_FIELD_CHARS = {"title": 200, "issuer": 120, "version": 40, "summary": 300, "reason": 300}

SYSTEM = """You sort the documents people give Cortex, an assistant for carbon removal projects that are monitored, reported and verified (MRV) under a carbon registry such as Puro.earth, Isometric, Verra or Gold Standard. Cortex answers questions from these documents and cites them, so each one must be filed in the right place, and only MRV material should be searched.

You get the file name and the opening pages of one document. Say what it is.

kind, one of:
- registry_rules: rules or a methodology issued by a registry or standard body: its general rules, a methodology or protocol, and the annexes, templates and guidance that registry issues with them.
- organisation_procedure: the organisation's own procedures, policies, manuals and standard operating procedures, when they are not about one site.
- reference: background for MRV work that is not the registry's rules: technical standards (ISO and the like), scientific papers, industry guidance and reports.
- project_design: documents that describe one project: project design document, project description, monitoring plan, site characterisation, life cycle assessment of that project.
- evidence: records of what happened on one project: laboratory results, certificates of analysis, chain of custody, delivery notes, invoices, contracts, permits, logs, site photographs.
- calibration: calibration certificates and maintenance records of instruments.
- verifier_correspondence: documents exchanged with a verifier (validation and verification body) or the registry about one project's validation or verification: findings, corrective action requests and responses, verification reports and statements.
- not_mrv: nothing to do with carbon removal, its monitoring, reporting or verification, a registry, or the organisation's operations (for example a CV, a menu, a holiday policy, a brochure for an unrelated product). Choose not_mrv only when you are sure; when unsure, choose the closest other kind.

title: the document's own title as printed on it, without its version or date. Not the file name. Empty if it has none.
issuer: who issued it, for example "Puro.earth" or the company's name. Empty if not stated.
version: its version or edition as printed, for example "4.4", "2024 v5" or "Rev 2". Empty if none.
summary: one sentence, at most 25 words, saying what the document is.
reason: one sentence, at most 25 words, for the person who gave the document, saying what in it shows its kind."""

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "issuer": {"type": "string"},
        "version": {"type": "string"},
        "summary": {"type": "string"},
        "kind": {"type": "string", "enum": list(KINDS)},
        "reason": {"type": "string"},
    },
    "required": ["title", "issuer", "version", "summary", "kind", "reason"],
    "additionalProperties": False,
}


class Unlabelled(Exception):
    """Claude gave no usable label. The document stays searchable, unlabelled."""


# ── Where a document is ─────────────────────────────────────────────────────


def place_of(key):
    """Scope, tenant, project, pin and file name from a document key."""
    scope = access.key_scope(key)
    parts = key.split("/")
    rest = {"shared": parts[4:], "tenant": parts[3:], "project": parts[4:]}[scope["scope"]]
    pin = rest[0] if scope["scope"] != "shared" and len(rest) > 1 else None
    return {**scope, "key": key, "pin": pin, "name": rest[-1]}


def searches_shared(project, shared_key):
    """Whether a project searches a registry document (access.retrieval_filter's rule)."""
    try:
        place = access.key_scope(shared_key)
    except ValueError:
        return False
    if place["scope"] != "shared":
        return False
    project = project or {}
    for field in access.SHARED_PLACE:
        if project.get(field) and place[field] not in (project[field], "any"):
            return False
    return True


def neighbour_prefixes(place):
    """Labels of the documents searched alongside this one, which it must not repeat.

    A project document is searched with its project's, its organisation's and the
    registry's documents. An organisation document is searched by every project, so
    it is compared with the organisation's and the registry's only: a copy in one
    project does not hold it back from the others (the web warns about that copy).
    """
    if place["scope"] == "project":
        tenant = f"labels/tenants/{place['tenant_id']}"
        return [f"{tenant}/projects/{place['project_id']}/", f"{tenant}/tenant/", "labels/shared/"]
    if place["scope"] == "tenant":
        return [f"labels/tenants/{place['tenant_id']}/tenant/", "labels/shared/"]
    return []


def label_key(document_key):
    return f"labels/{document_key}.json"


def document_key(label_object_key):
    return label_object_key[len("labels/") : -len(".json")]


# ── What Claude reads ───────────────────────────────────────────────────────


def _order(element):
    pages = element.get("page_indices") or [0]
    return (min(pages), element.get("reading_order") or 0)


def excerpt(elements, limit=EXCERPT_CHARS):
    """The document's opening text in reading order (title page, contents, introduction),
    each running header or footer once, and its page count."""
    parts, seen, size = [], set(), 0
    for element in sorted(elements, key=_order):
        if element.get("type") == "PAGE_NUMBER":
            continue
        text = clauses.element_text(element)
        if not text or text in seen:
            continue
        seen.add(text)
        parts.append(text)
        size += len(text) + 2
        if size >= limit:
            break
    pages = max((max(e.get("page_indices") or [0]) for e in elements), default=-1) + 1
    return "\n\n".join(parts)[:limit], pages


def prompt(place, project, text, pages):
    """The user turn: the file name, the project's methodology and the opening text.

    Not the pin it was given to: Claude labels what the document is, and Cortex
    compares that with where it was put.
    """
    lines = [f"File name: {place['name']}"]
    if pages:
        lines.append(f"Pages: {pages}")
    if project and project.get("methodology"):
        followed = " ".join(str(project[field]) for field in ("registry", "methodology", "edition") if project.get(field))
        lines.append(f"The project it was given to follows: {followed}")
    lines += ["", "Opening of the document:", "<document>", text, "</document>"]
    return "\n".join(lines)


# ── Claude's answer ─────────────────────────────────────────────────────────


def _words(text):
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


_VERSION_PREFIX = re.compile(r"\b(?:version|edition|revision|rev|v)\.?\s*(?=\d)", re.IGNORECASE)
_VERSION_IN_TITLE = re.compile(r"\b(?:version|edition|revision|rev)\b\.?\s*[\w.\-]*", re.IGNORECASE)


def version_key(version):
    """ "Version 4.4", "v4.4" and "4.4" are one version; "2024-v5" and "2024 v5" another."""
    return _words(_VERSION_PREFIX.sub("", version or "")).replace(" ", ".")


def title_key(title, version=""):
    """A title without its version, case or punctuation."""
    text = title or ""
    if version:
        text = text.replace(version, " ")
    return _words(_VERSION_IN_TITLE.sub(" ", text))


def label_from(output):
    """Claude's schema-checked answer, trimmed, with what Cortex derives from the kind."""
    if not isinstance(output, dict) or output.get("kind") not in KINDS:
        raise Unlabelled("The answer has no known kind.")
    label = {"checked": True, "kind": output["kind"]}
    for field, limit in MAX_FIELD_CHARS.items():
        label[field] = " ".join(str(output.get(field) or "").split())[:limit]
    label["pin"], label["applies_to"] = KINDS[label["kind"]]
    label["title_key"] = title_key(label["title"], label["version"])
    label["version_key"] = version_key(label["version"])
    return label


def same_document(label, other):
    """Two labels for one document: same kind of identified document, same title and
    version, and no different issuers. A lab certificate never matches on its title."""
    if label.get("kind") not in IDENTIFIED_BY_TITLE or other.get("kind") not in IDENTIFIED_BY_TITLE:
        return False
    if len(label.get("title_key") or "") < 6 or label.get("title_key") != other.get("title_key"):
        return False
    if not label.get("version_key") or label.get("version_key") != other.get("version_key"):
        return False
    issuers = {_words(label.get("issuer")), _words(other.get("issuer"))} - {""}
    return len(issuers) <= 1


def held_now(label):
    """Kept out of search: held, and nobody has kept it in Cortex since."""
    return bool(label.get("held")) and not label.get("released")


def hold(label, place, neighbours):
    """(held, same_as): why Cortex holds the document out of search, or (None, None).

    Registry documents are never held: operators add them. An unlabelled document
    is never held either: labelling never stands between a document and search.
    """
    if place["scope"] == "shared" or not label.get("checked"):
        return None, None
    if label["kind"] == "not_mrv":
        return "not_mrv", None
    for other in neighbours:
        if other.get("key") == place["key"] or held_now(other):
            continue
        if same_document(label, other):
            return "same_as", {"key": other["key"], "title": other.get("title"), "version": other.get("version")}
    return None, None


def record(document, place, label, previous, neighbours, model, now):
    """The label file for one document.

    previous is the label file already there for this key, if any. A person's
    "keep it in Cortex" stands for the same file (same doc_id); their "keep it
    here" stands while Claude suggests the same place it suggested then.
    """
    previous = previous or {}
    held, same_as = hold(label, place, neighbours)
    released = previous.get("released") if held and previous.get("doc_id") == document["doc_id"] else None
    placement_kept = (
        previous.get("placement_kept")
        if label.get("checked")
        and previous.get("pin") == label.get("pin")
        and previous.get("applies_to") == label.get("applies_to")
        else None
    )
    return {
        **label,
        "key": document["key"],
        "doc_id": document["doc_id"],
        "model": model,
        "labelled_at": now,
        "held": held,
        "same_as": same_as,
        "released": released,
        "placement_kept": placement_kept,
    }
