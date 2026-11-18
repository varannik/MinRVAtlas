"""AgentCore Gateway REQUEST interceptor: tenant and project access for every MCP call.

The gateway has verified the token (signature, expiry, client) before this runs.
This function makes sure the token carries a tenant, that the tenant is active,
that any project asked for is one the user holds a grant for, and then writes
the caller block into the tool arguments. Tools trust only that block.
"""

import json
import logging

import access
import tenancy

log = logging.getLogger()
log.setLevel(logging.INFO)


def handler(event, _context):
    output, decision = access.intercept(event, tenancy.lookup)
    # One structured line per decision: the audit trail for tool access.
    log.info(json.dumps({"cortex_access": decision}))
    return output
