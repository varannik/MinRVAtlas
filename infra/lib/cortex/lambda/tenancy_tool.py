"""MCP tools in the `tenancy` target.

  whoami   the caller's tenant, role and the projects they may work on
"""

import access
import tenancy


def handler(event, _context):
    try:
        caller = access.require_caller(event)
    except access.Denied as error:
        return {"error": str(error)}
    projects = []
    for project_id in caller["project_ids"]:
        item = tenancy.project(caller["tenant_id"], project_id) or {}
        projects.append(
            {
                "project_id": project_id,
                "name": item.get("name"),
                "registry": item.get("registry"),
                "methodology": item.get("methodology"),
                "edition": item.get("edition"),
            }
        )
    meta = tenancy.tenant(caller["tenant_id"]) or {}
    return {
        "tenant_id": caller["tenant_id"],
        "tenant_name": meta.get("name"),
        "role": caller["role"],
        "projects": projects,
    }
