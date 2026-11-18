"""Reads the Cortex tenancy table.

Items (pk / sk):
  TENANT#<tenant>  META                      status, name, isolation
  TENANT#<tenant>  PROJECT#<project>         name, registry, methodology, edition
  TENANT#<tenant>  MEMBER#<sub>#<project>    role on that project
"""

import os

_table = None


def table():
    global _table
    if _table is None:
        import boto3

        _table = boto3.resource("dynamodb").Table(os.environ["TENANCY_TABLE"])
    return _table


def _query_prefix(pk, prefix):
    from boto3.dynamodb.conditions import Key

    items, start = [], None
    while True:
        args = {"KeyConditionExpression": Key("pk").eq(pk) & Key("sk").begins_with(prefix)}
        if start:
            args["ExclusiveStartKey"] = start
        page = table().query(**args)
        items.extend(page.get("Items", []))
        start = page.get("LastEvaluatedKey")
        if not start:
            return items


def lookup(tenant_id, sub):
    """(tenant_status, tenant_project_ids, member_project_ids) for one user."""
    pk = f"TENANT#{tenant_id}"
    meta = table().get_item(Key={"pk": pk, "sk": "META"}).get("Item") or {}
    projects = [item["sk"].split("#", 1)[1] for item in _query_prefix(pk, "PROJECT#")]
    members = [item["sk"].rsplit("#", 1)[1] for item in _query_prefix(pk, f"MEMBER#{sub}#")]
    return meta.get("status", "missing"), projects, members


def project(tenant_id, project_id):
    if not project_id:
        return None
    item = table().get_item(Key={"pk": f"TENANT#{tenant_id}", "sk": f"PROJECT#{project_id}"}).get("Item")
    return dict(item) if item else None


def tenant(tenant_id):
    item = table().get_item(Key={"pk": f"TENANT#{tenant_id}", "sk": "META"}).get("Item")
    return dict(item) if item else None
