"""Custom resource: create the Cortex schema in the knowledge Aurora cluster.

Uses the RDS Data API, so it needs no VPC access. Statements in
sql/001_cortex.sql are separated by lines holding only `---` and are written to
be safe to run again. Login roles are created first, with passwords from their
own secrets, so the grants in the SQL file have someone to grant to.
"""

import json
import os
import re
import time

_rds = None
_secrets = None
ROLE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,40}$")
PASSWORD = re.compile(r"^[A-Za-z0-9]{24,128}$")


def rds():
    global _rds
    if _rds is None:
        import boto3

        _rds = boto3.client("rds-data")
    return _rds


def secrets():
    global _secrets
    if _secrets is None:
        import boto3

        _secrets = boto3.client("secretsmanager")
    return _secrets


def statements(text):
    chunks = re.split(r"^---\s*$", text, flags=re.MULTILINE)
    out = []
    for chunk in chunks:
        lines = [line for line in chunk.strip().splitlines() if not line.strip().startswith("--")]
        sql = "\n".join(lines).strip()
        if sql:
            out.append(sql)
    return out


def execute(sql):
    # An auto-paused cluster takes a few seconds to resume; the first calls fail until it has.
    for attempt in range(30):
        try:
            return rds().execute_statement(
                resourceArn=os.environ["CLUSTER_ARN"],
                secretArn=os.environ["ADMIN_SECRET_ARN"],
                database=os.environ["DATABASE"],
                sql=sql,
            )
        except Exception as error:  # noqa: BLE001 — the Data API raises several resume errors
            text = f"{type(error).__name__}: {error}"
            if "resum" in text.lower() or "DatabaseNotFound" in text or "Communications link failure" in text:
                time.sleep(min(2 + attempt, 10))
                continue
            raise
    raise RuntimeError("The knowledge cluster did not resume in time")


def ensure_role(secret_arn):
    secret = json.loads(secrets().get_secret_value(SecretId=secret_arn)["SecretString"])
    user, password = secret["username"], secret["password"]
    if not ROLE_NAME.match(user) or not PASSWORD.match(password):
        raise ValueError(f"Secret {secret_arn} holds an unexpected role name or password format")
    execute(
        "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '%s') "
        "THEN CREATE ROLE %s LOGIN NOBYPASSRLS; END IF; END $$" % (user, user)
    )
    execute("ALTER ROLE %s WITH LOGIN NOBYPASSRLS PASSWORD '%s'" % (user, password))
    return user


def handler(event, _context):
    if event["RequestType"] == "Delete":
        # The cluster keeps its data (and is snapshotted or retained by its own policy).
        return {"PhysicalResourceId": event.get("PhysicalResourceId", "cortex-schema")}
    roles = [ensure_role(arn) for arn in os.environ["ROLE_SECRET_ARNS"].split(",") if arn]
    path = os.path.join(os.path.dirname(__file__), "sql", "001_cortex.sql")
    with open(path, encoding="utf-8") as handle:
        sqls = statements(handle.read())
    for sql in sqls:
        execute(sql)
    return {
        "PhysicalResourceId": "cortex-schema",
        "Data": {"Statements": str(len(sqls)), "Roles": ",".join(roles)},
    }
