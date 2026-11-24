"""The run's Lambda steps against in-memory S3 and DynamoDB (no AWS)."""

import io
import json
import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from quality_engine import handlers  # noqa: E402

ENV = {"QUALITY_TABLE": "quality", "QUALITY_BUCKET": "quality-parts", "STREAM_BUCKET": "stream", "ATLAS_BUCKET": "atlas"}
RUN = {"run_id": "20261124T101500Z-ab12", "tenant_id": "fourfourone", "project_id": "fujairah-mineral", "registry_slug": "puro", "requested_by": "u1"}


class NoSuchKey(Exception):
    def __init__(self):
        super().__init__("NoSuchKey")
        self.response = {"Error": {"Code": "NoSuchKey"}}


class ConditionalCheckFailedException(Exception):
    pass


class FakeS3:
    def __init__(self):
        self.objects = {}

    def put(self, bucket, key, body):
        self.objects[(bucket, key)] = body.encode() if isinstance(body, str) else body

    def list_objects_v2(self, Bucket, Prefix, **_):
        keys = sorted(key for bucket, key in self.objects if bucket == Bucket and key.startswith(Prefix))
        return {"Contents": [{"Key": key, "ETag": f'"{len(self.objects[(Bucket, key)])}"'} for key in keys], "IsTruncated": False}

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise NoSuchKey()
        return {"ETag": '"seed-etag"'}

    def get_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise NoSuchKey()
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def put_object(self, Bucket, Key, Body, **_):
        self.objects[(Bucket, Key)] = Body


class FakeDynamo:
    def __init__(self):
        self.items = {}

    def put_item(self, TableName, Item, ConditionExpression=None):
        key = (Item["pk"]["S"], Item["sk"]["S"])
        if ConditionExpression and key in self.items:
            raise ConditionalCheckFailedException()
        self.items[key] = Item

    def update_item(self, TableName, Key, UpdateExpression, ExpressionAttributeValues, ExpressionAttributeNames=None):
        item = self.items.setdefault((Key["pk"]["S"], Key["sk"]["S"]), dict(Key))
        names = ExpressionAttributeNames or {}
        for part in UpdateExpression.removeprefix("SET ").split(", "):
            field, value = (side.strip() for side in part.split("="))
            item[names.get(field, field)] = ExpressionAttributeValues[value]

    def query(self, TableName, KeyConditionExpression, ExpressionAttributeValues, **_):
        pk, prefix = ExpressionAttributeValues[":pk"]["S"], ExpressionAttributeValues[":review"]["S"]
        return {"Items": [item for (p, s), item in sorted(self.items.items()) if p == pk and s.startswith(prefix)]}

    def batch_write_item(self, RequestItems):
        for requests in RequestItems.values():
            for request in requests:
                item = request["PutRequest"]["Item"]
                self.items[(item["pk"]["S"], item["sk"]["S"])] = item
        return {"UnprocessedItems": {}}


def day_csv(day, power=800.0, rows_per_hour=30):
    lines = ["timestamp_utc,metric,value,unit,quality"]
    for hour in range(24):
        for step in range(rows_per_hour):
            minute = step * 2
            lines.append(f"{day}T{hour:02d}:{minute:02d}:00Z,CAPTURE_POWER_kW,{power + (step % 7)},kW,ok")
    lines.append(f"{day}T10:00:00Z,LCO2_DELIVERED_t,22.4,t,ok")
    return "\n".join(lines)


class HandlerTest(unittest.TestCase):
    def setUp(self):
        self.s3, self.dynamo = FakeS3(), FakeDynamo()
        patcher = mock.patch.dict(handlers._clients, {"s3": self.s3, "dynamodb": self.dynamo}, clear=True)
        patcher.start()
        self.addCleanup(patcher.stop)
        env = mock.patch.dict(os.environ, ENV)
        env.start()
        self.addCleanup(env.stop)

    def run_all(self):
        planned = handlers.plan({"run": RUN})
        parts = [handlers.fold({"run": RUN, **batch}) for batch in planned["batches"]]
        return planned, handlers.judge({"run": RUN, "plan": planned, "parts": parts})

    def test_a_stream_run_from_plan_to_verdict(self):
        prefix = "fourfourone/puro/fujairah-mineral/"
        for day in ("2026-08-01", "2026-08-02", "2026-08-06"):
            self.s3.put("stream", f"{prefix}dt={day}/observations.csv", day_csv(day))
        self.s3.put("stream", f"{prefix}attributes.json", json.dumps({"periodStart": "2026-08-01", "periodEnd": "2026-08-31", "values": {"BIOGENIC_FRACTION_pct": 38}}))
        planned, result = self.run_all()
        self.assertEqual(planned["source"], "stream")
        self.assertEqual(len(planned["batches"]), 1)
        self.assertEqual(result["verdict"], "blocked")  # 3–5 Aug: three days in a row with nothing
        run = self.dynamo.items[("TENANT#fourfourone#PROJECT#fujairah-mineral", f"RUN#{RUN['run_id']}")]
        self.assertEqual(run["status"]["S"], "done")
        self.assertEqual(json.loads(run["result"]["S"])["range"], {"start": "2026-08-01", "end": "2026-08-06"})
        findings = [json.loads(item["finding"]["S"]) for (pk, sk), item in self.dynamo.items.items() if sk.startswith("FINDING#")]
        self.assertEqual([(f["kind"], f["start"], f["end"]) for f in findings], [("missing_days", "2026-08-03", "2026-08-05")])
        self.assertTrue(findings[0]["text"]["headline"].startswith("No readings at all for 3 days"))

    def test_a_seeded_project(self):
        seeded = {"days": [{"day": "2026-08-01", "metrics": {"GROSS_REMOVAL_t": {"sum": 10, "mean": 10, "min": 10, "max": 10, "last": 10, "count": 1}}}], "fixed": []}
        self.s3.put("atlas", "mrv/fourfourone/puro/fujairah-mineral.json", json.dumps(seeded))
        planned, result = self.run_all()
        self.assertEqual(planned, {"source": "seeded", "batches": [], "dataHash": "seed-etag"})
        self.assertEqual(result["verdict"], "clear")

    def test_no_data(self):
        planned, result = self.run_all()
        self.assertEqual(planned["source"], "none")
        self.assertEqual(result["verdict"], "clear")
        self.assertIsNone(result["range"])

    def test_a_decision_is_read_back(self):
        prefix = "fourfourone/puro/fujairah-mineral/"
        for day in ("2026-08-01", "2026-08-06"):
            self.s3.put("stream", f"{prefix}dt={day}/observations.csv", day_csv(day))
        _, first = self.run_all()
        finding_id = next(json.loads(i["finding"]["S"])["id"] for (_, sk), i in self.dynamo.items.items() if sk.startswith("FINDING#"))
        self.dynamo.items[("TENANT#fourfourone#PROJECT#fujairah-mineral", f"REVIEW#{finding_id}")] = {
            "pk": {"S": "TENANT#fourfourone#PROJECT#fujairah-mineral"},
            "sk": {"S": f"REVIEW#{finding_id}"},
            "review": {"S": json.dumps({"decision": "dismissed", "reason": "Site offline for maintenance", "by": "u1", "at": "2026-11-24T10:00:00Z"})},
        }
        _, again = self.run_all()
        self.assertEqual(first["verdict"], "blocked")
        self.assertEqual(again["verdict"], "clear")

    def test_ids_are_checked_before_any_key_is_built(self):
        with self.assertRaises(handlers.NotAllowed):
            handlers.plan({"run": {**RUN, "project_id": "../other"}})
        with self.assertRaises(handlers.NotAllowed):
            handlers.plan({"run": {**RUN, "registry_slug": "unknown"}})

    def test_fold_reads_only_its_own_project(self):
        self.s3.put("stream", "other/puro/elsewhere/dt=2026-08-01/observations.csv", day_csv("2026-08-01"))
        result = handlers.fold({"run": RUN, "keys": ["other/puro/elsewhere/dt=2026-08-01/observations.csv"]})
        self.assertEqual(result, {"part": None})

    def test_a_failed_run_is_marked(self):
        handlers.plan({"run": RUN})
        handlers.fail({"run": RUN, "error": {"Error": "States.TaskFailed", "Cause": "boom"}})
        run = self.dynamo.items[("TENANT#fourfourone#PROJECT#fujairah-mineral", f"RUN#{RUN['run_id']}")]
        self.assertEqual(run["status"]["S"], "failed")


if __name__ == "__main__":
    unittest.main()
