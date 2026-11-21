"""An in-memory S3 client with the calls the Cortex ingestion tasks make."""

import io


class ClientError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class NoSuchKey(ClientError):
    def __init__(self):
        super().__init__("NoSuchKey")


class _Exceptions:
    ClientError = ClientError
    NoSuchKey = NoSuchKey


class _Paginator:
    def __init__(self, s3):
        self.s3 = s3

    def paginate(self, Bucket, Prefix=""):
        keys = sorted(key for key in self.s3.buckets.get(Bucket, {}) if key.startswith(Prefix))
        yield {"Contents": [{"Key": key} for key in keys]} if keys else {}


class FakeS3:
    exceptions = _Exceptions

    def __init__(self):
        self.buckets = {}
        self.copies = []

    def put(self, bucket, key, body=b"", **meta):
        self.buckets.setdefault(bucket, {})[key] = {"Body": body if isinstance(body, bytes) else body.encode(), **meta}

    def keys(self, bucket, prefix=""):
        return sorted(key for key in self.buckets.get(bucket, {}) if key.startswith(prefix))

    def body(self, bucket, key):
        return self.buckets[bucket][key]["Body"]

    # boto3 calls

    def get_object(self, Bucket, Key):
        item = self.buckets.get(Bucket, {}).get(Key)
        if item is None:
            raise NoSuchKey()
        return {"Body": io.BytesIO(item["Body"])}

    def head_object(self, Bucket, Key):
        if Key not in self.buckets.get(Bucket, {}):
            raise ClientError("404")
        return {}

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.put(Bucket, Key, Body, ContentType=ContentType)

    def copy_object(self, Bucket, Key, CopySource, **options):
        source = self.buckets[CopySource["Bucket"]][CopySource["Key"]]
        self.buckets.setdefault(Bucket, {})[Key] = dict(source)
        self.copies.append({"to": (Bucket, Key), "from": (CopySource["Bucket"], CopySource["Key"]), **options})

    def delete_object(self, Bucket, Key):
        self.buckets.get(Bucket, {}).pop(Key, None)

    def delete_objects(self, Bucket, Delete, **_):
        for item in Delete["Objects"]:
            self.delete_object(Bucket, item["Key"])

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return _Paginator(self)
