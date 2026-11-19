"""Split Bedrock Data Automation document output into one passage per rule.

Registry methodologies number their rules x.y.z ("2.2.2 The Crediting Period
in this methodology is 15 years ..."). A passage starts at a rule number and
runs to the next rule or heading, so a search hit cites one rule. Headings
(x or x.y, or a title element) set the section that following passages carry,
and text between a heading and its first rule becomes a short passage of its
own, cited by the heading number. Every rule passage starts with its number.

Data Automation lays rules out in several ways, all handled here:
  - at the start of a line, often as a list item ("- 2.2.1 The ..."), with
    several rules in one element, so text is read line by line;
  - as a margin number merged into its paragraph ("... during a 4.3.1
    monitoring period ..."). Such a number starts a rule only when nothing
    introduces it as a reference ("see rule 4.3.1", "subrule 4.4.7 (a)") and it
    is the next rule in sequence;
  - as margin numbers on a line of their own, which label the paragraphs that
    follow;
  - with the section number after the heading ("Overall equation 4.3").

Pure functions only: the chunk Lambda reads and writes S3 around them.
"""

import re

_NUMBER = r"\d{1,2}(?:\.\d{1,3}){2,4}"
# "2.2.2" at the start of a line: optionally a list item, markdown heading or bold.
RULE = re.compile(r"^\s*(?:[-*•]\s+)?(?:#{1,6}\s*)?(?:\*\*)?(" + _NUMBER + r")\.?(?:\*\*)?(?=\s|$)")
LIST_MARK = re.compile(r"^\s*[-*•]\s+")
# "4", "4.3" followed by a short title on one line ("4.3 Overall equation").
HEADING = re.compile(r"^\s*(?:#{1,6}\s*)?(?:\*\*)?(\d{1,2}(?:\.\d{1,3})?)\.?(?:\*\*)?\s+(\S[^\n]{0,118})$")
# The same with the number last ("## Overall equation 4.3"), for heading elements only.
TRAILING_HEADING = re.compile(r"^\s*(?:#{1,6}\s*)?(?:\*\*)?(\S[^\n]{0,118}?)\s+(\d{1,2}(?:\.\d{1,3})?)\.?(?:\*\*)?\s*$")
NOT_SECTION_WORDS = frozenset({"table", "figure", "equation", "annex", "appendix", "version", "v", "step", "phase", "part", "example"})
# A rule number inside a line, possibly in italics ("cap- *4.4.5* tured").
INLINE_RULE = re.compile(r"(?<![\w.\-–/(])\*?(" + _NUMBER + r")\*?(?![\w.\-–/])")
# Words that introduce a number as a reference to another rule, not as a margin number.
REFERENCE_WORDS = frozenset({"rule", "rules", "subrule", "subrules", "section", "sections", "and", "or", "to", "see",
                             "table", "figure", "chapter", "annex", "appendix", "version"})
# "4.4.7 (a)", "4.3.1)", "4.3.4-4.3.6": a reference.
REFERENCE_TAIL = re.compile(r"^\*?\s*(?:\(\w{1,4}\)|\)|[-–]\s*\d)")
# Some layouts print rule numbers in the left margin, so they arrive on their own
# ("2.2.2", or "2.2.1 2.2.2" together) or stuck to a heading
# ("2.2 2.2.1 2.2.2 Production Facility ..."). They label the paragraphs that follow.
RULE_NUMBER = re.compile(_NUMBER)
ONLY_RULE_NUMBERS = re.compile(r"^\s*(?:" + _NUMBER + r"\s*)+$")
LEADING_RULE_NUMBERS = re.compile(r"^((?:" + _NUMBER + r"\s+)+)(\S.*)$")
# A word broken across a line end ("par- ticipants").
BROKEN_WORD = re.compile(r"\b([A-Za-z]{2,})- ([a-z]{2,})\b")
HEADING_TYPES = frozenset({"TITLE", "SECTION_TITLE", "SECTION_HEADER"})
# Unnumbered titles start a section. Unnumbered section headers ("EXAMPLE") stay in
# their rule, except in the front matter ("Glossary", "Acronyms").
TITLE_TYPES = frozenset({"TITLE", "SECTION_TITLE"})
# A table of contents lists every section title and would match any question.
CONTENTS_TITLES = frozenset({"contents", "table of contents"})
# Running headers, footers, page numbers and logos repeat on every page and split rules apart.
SKIP_TYPES = frozenset({"HEADER", "FOOTER", "PAGE_NUMBER", "LOGO"})
MAX_CHARS = 6000
MIN_CHARS = 40


def element_text(element):
    rep = element.get("representation") or {}
    text = (rep.get("markdown") or rep.get("text") or "").replace("\t", " ")
    if element.get("type") == "FIGURE":
        title = element.get("title") or ""
        text = "\n".join(part for part in (f"[Figure] {title}".strip(), text) if part and part != "[Figure]")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _order(element):
    pages = element.get("page_indices") or [0]
    return (min(pages), element.get("reading_order") or 0)


def _plain(text):
    return re.sub(r"^#{1,6}\s*|\*\*", "", text).strip()


def _key(ref):
    return tuple(int(part) for part in ref.split("."))


def _vocabulary(texts):
    return {word.lower() for text in texts for word in re.findall(r"[A-Za-z]{4,}", text)}


def _join_broken_words(text, vocabulary):
    """'par- ticipants' -> 'participants' when the document uses that word elsewhere."""

    def join(match):
        word = match.group(1) + match.group(2)
        return word if word.lower() in vocabulary else match.group(0)

    return BROKEN_WORD.sub(join, text)


def _heading(element, text):
    """(number, title) when the element is a section heading, else None."""
    if "\n" in text.strip():
        return None
    match = HEADING.match(text)
    if match and not text.rstrip().endswith("."):
        return match.group(1), _plain(match.group(2))
    if element.get("sub_type") in HEADING_TYPES:
        trailing = TRAILING_HEADING.match(text)
        words = _plain(trailing.group(1)).split() if trailing else []
        # "Overall equation 4.3" is a heading; "Table 3" or "Figure 2" on its own is a caption.
        if words and not (len(words) == 1 and words[0].lower() in NOT_SECTION_WORDS):
            return trailing.group(2), _plain(trailing.group(1))
    if element.get("sub_type") in TITLE_TYPES and len(text) <= 160:
        return "", _plain(text)
    return None


def _is_reference(line, match):
    before = re.findall(r"[A-Za-z]+", line[max(0, match.start() - 30) : match.start()])
    return bool(before and before[-1].lower() in REFERENCE_WORDS) or bool(REFERENCE_TAIL.match(line[match.end() :]))


def _split(body, limit=MAX_CHARS):
    """Pieces of at most limit characters, cut at paragraph breaks where possible."""
    if len(body) <= limit:
        return [body]
    pieces, current = [], ""
    for paragraph in body.split("\n\n"):
        while len(paragraph) > limit:
            if current:
                pieces.append(current)
                current = ""
            pieces.append(paragraph[:limit])
            paragraph = paragraph[limit:]
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) > limit:
            pieces.append(current)
            current = paragraph
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


class _Splitter:
    """Walks elements in reading order and collects one passage per rule."""

    def __init__(self):
        self.found = []
        self.current = None
        self.section = ""
        self.section_ref = ""
        self.last_rule = ""
        self.pending = []  # margin rule numbers waiting for their paragraphs

    def close(self):
        if self.current and self.current["parts"]:
            self.found.append(self.current)
        self.current = None

    def open(self, ref):
        self.close()
        self.current = {"clause_ref": ref, "section": self.section, "pages": set(), "parts": []}
        if is_rule(ref):
            self.last_rule = ref
            if self.pending and self.pending[0] == ref:
                self.pending.pop(0)

    def heading(self, number, title):
        margin = LEADING_RULE_NUMBERS.match(title)
        if margin:
            self.pending.extend(RULE_NUMBER.findall(margin.group(1)))
            title = margin.group(2)
        self.section = f"{number} {title}".strip()
        self.section_ref = number or self.section_ref
        self.open(self.section_ref)

    def add(self, text, pages):
        if not text:
            return
        if self.current is None:
            self.open(self.section_ref)
        self.current["parts"].append(text)
        self.current["pages"].update(pages)

    def follows(self, ref):
        """True when ref can be the next rule: shortly after the last one, or early in this or the next section."""
        parts = _key(ref)
        if len(parts) != 3:
            return False
        last = _key(self.last_rule) if self.last_rule else ()
        if len(last) == 3:
            if parts[:2] == last[:2]:
                return last[2] < parts[2] <= last[2] + 3
            if parts[:2] == (last[0], last[1] + 1) and parts[2] == 1:
                return True
        section = _key(self.section_ref) if self.section_ref else ()
        return len(section) == 2 and parts[:2] == section and parts[2] <= 3

    def next_section(self, number):
        parts = _key(number)
        if len(parts) != 2:
            return False
        for ref in (self.section_ref, self.last_rule):
            known = _key(ref)[:2] if ref else ()
            if len(known) == 2 and parts in ((known[0], known[1] + 1), (known[0] + 1, 1)):
                return True
        return False

    def line_start(self, line, first_of_paragraph):
        """("rule", ref, text) when the line starts a rule, ("heading", number, title) for a
        section heading inside a longer element, else None. Changes no state."""
        rule = RULE.match(line)
        if rule:
            return "rule", rule.group(1), LIST_MARK.sub("", line, count=1).strip()
        heading = HEADING.match(line)
        if heading and not line.rstrip().endswith(".") and self.next_section(heading.group(1)):
            return "heading", heading.group(1), _plain(heading.group(2))
        for match in INLINE_RULE.finditer(line):
            ref = match.group(1)
            if not _is_reference(line, match) and self.follows(ref):
                rest = f"{line[: match.start()].rstrip()} {line[match.end() :].lstrip()}".strip()
                return "rule", ref, f"{ref} {LIST_MARK.sub('', rest, count=1)}"
        if first_of_paragraph and self.pending:
            return "rule", self.pending[0], f"{self.pending[0]} {line.strip()}"
        return None

    def element(self, element, text, pages):
        if ONLY_RULE_NUMBERS.match(_plain(text)):
            self.pending.extend(RULE_NUMBER.findall(text))
            return
        heading = None if RULE.match(text) else _heading(element, text)
        if heading is None and not self.section_ref and element.get("sub_type") == "SECTION_HEADER" and "\n" not in text:
            heading = "", _plain(text)
        if heading:
            self.heading(*heading)
            return
        if element.get("type", "TEXT") != "TEXT":
            self.add(text, pages)  # tables and figures stay whole, in the rule they sit in
            return
        paragraph = element.get("sub_type") in (None, "", "PARAGRAPH")
        run = []
        for number, line in enumerate(text.split("\n")):
            start = self.line_start(line, paragraph and number == 0)
            if start is None:
                run.append(line)
                continue
            self.add("\n".join(run).strip(), pages)  # the lines so far belong to the passage before
            run = []
            kind, ref, body = start
            if kind == "heading":
                self.heading(ref, body)
            else:
                self.open(ref)  # also takes ref off the pending margin numbers
                run.append(body)
        self.add("\n".join(run).strip(), pages)


def passages(elements):
    """Passages in document order.

    Each is {"clause_ref", "section", "page", "pages", "part", "text"}: clause_ref
    is the rule number (or the heading number for text before a section's first
    rule), page is the first PDF page (1-based), and text starts with the
    section so the passage reads on its own.
    """
    kept = []
    for element in sorted(elements, key=_order):
        if element.get("sub_type") in SKIP_TYPES:
            continue
        text = element_text(element)
        if text:
            kept.append((element, text))
    vocabulary = _vocabulary(text for _, text in kept)

    splitter = _Splitter()
    for element, text in kept:
        pages = sorted({index + 1 for index in (element.get("page_indices") or [])})
        splitter.element(element, _join_broken_words(text, vocabulary), pages)
    splitter.close()

    result = []
    for passage in splitter.found:
        body = "\n\n".join(passage["parts"])
        if len(body) < MIN_CHARS or passage["section"].lower() in CONTENTS_TITLES:
            continue
        pages = sorted(passage["pages"])
        header = f"Section {passage['section']}\n\n" if passage["section"] else ""
        pieces = _split(body, MAX_CHARS - len(header))
        for number, piece in enumerate(pieces, 1):
            result.append(
                {
                    "clause_ref": passage["clause_ref"],
                    "section": passage["section"],
                    "page": pages[0] if pages else None,
                    "pages": pages,
                    "part": number if len(pieces) > 1 else None,
                    "text": header + piece,
                }
            )
    return result


def is_rule(clause_ref):
    """True for a rule number (x.y.z), false for a heading number or none."""
    return bool(clause_ref) and clause_ref.count(".") >= 2
