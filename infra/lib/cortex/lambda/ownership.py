"""Which documents a request from the web may change.

The removal, review and move tasks all act on one document for a user the web
has already checked. These rules are checked again here, whatever the request says.
"""

import access

# Pins that take documents, and those whose documents can apply to every project
# (apps/web/src/lib/cortex/uploads.ts: DOCUMENT_PINS, ORGANISATION_PINS).
DOCUMENT_PINS = frozenset({"evidence", "calibration", "knowledge", "protocols", "reviewer"})
ORGANISATION_PINS = frozenset({"knowledge", "protocols", "reviewer"})


class NotAllowed(Exception):
    """The request is not for the requesting tenant's or project's own document. Step Functions catches this by name."""


def check(event, key=None):
    """The key (the request's own by default) must be a document of the tenant named in the
    request: one of the named project's, or one of the tenant's own (the web lets only
    organisation admins ask for those). Never a shared registry document."""
    key = event.get("key") if key is None else key
    try:
        scope = access.key_scope(key)
    except ValueError as error:
        raise NotAllowed(str(error)) from None
    if scope["scope"] == "tenant" and scope["tenant_id"] == event.get("tenant_id"):
        return key
    if (
        scope["scope"] != "project"
        or scope["tenant_id"] != event.get("tenant_id")
        or scope["project_id"] != event.get("project_id")
    ):
        raise NotAllowed(f"{key} is not a document of project {event.get('project_id')}.")
    return key


def pin_of(key):
    """The pin in tenants/<t>/tenant/<pin>/<file> or tenants/<t>/projects/<p>/<pin>/<file>; None otherwise."""
    parts = key.split("/")
    rest = parts[3:] if parts[2:3] == ["tenant"] else parts[4:]
    return rest[0] if len(rest) > 1 else None


def move_target(event):
    """The key a document moves to: the same file, on another pin of the same project,
    or given to (or taken back from) the whole organisation."""
    source = check(event)
    target = check(event, event.get("to_key"))
    if target == source:
        raise NotAllowed("The document is already there.")
    if target.rsplit("/", 1)[-1] != source.rsplit("/", 1)[-1]:
        raise NotAllowed("A move keeps the file's name.")
    pin = pin_of(target)
    if pin not in DOCUMENT_PINS:
        raise NotAllowed(f"{target} is not on a pin that takes documents.")
    if access.key_scope(target)["scope"] == "tenant" and pin not in ORGANISATION_PINS:
        raise NotAllowed(f"The {pin} pin only takes project documents.")
    return source, target
