"""knowledge.search waits out the knowledge database resuming from auto-pause (no AWS needed)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "lib", "cortex", "lambda"))

import knowledge_tool  # noqa: E402


class ClientError(Exception):
    """Shaped like botocore's ClientError: a message and a response with an error code."""

    def __init__(self, code, message):
        super().__init__(message)
        self.response = {"Error": {"Code": code, "Message": message}}


PAUSED = (
    "ValidationException",
    "The knowledge base storage configuration provided is invalid... The Aurora DB instance "
    "db-X is resuming after being auto-paused. Please wait a few seconds and try again.",
)


class Flaky:
    """Fails with the given errors in turn, then returns a result."""

    def __init__(self, *errors):
        self.errors = list(errors)
        self.calls = 0

    def __call__(self, **kwargs):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return {"retrievalResults": [], "kwargs": kwargs}


class RetrieveTest(unittest.TestCase):
    def setUp(self):
        self.slept = []

    def retrieve(self, call):
        return knowledge_tool.retrieve(call, waits=(1, 2, 3), sleep=self.slept.append, knowledgeBaseId="kb")

    def test_waits_while_the_database_resumes(self):
        call = Flaky(ClientError(*PAUSED), ClientError(*PAUSED))
        result = self.retrieve(call)
        self.assertEqual(result["kwargs"], {"knowledgeBaseId": "kb"})
        self.assertEqual(call.calls, 3)
        self.assertEqual(self.slept, [1, 2])

    def test_gives_up_with_resuming_after_the_last_wait(self):
        call = Flaky(*(ClientError(*PAUSED) for _ in range(4)))
        with self.assertRaises(knowledge_tool.Resuming):
            self.retrieve(call)
        self.assertEqual(call.calls, 4)
        self.assertEqual(self.slept, [1, 2, 3])

    def test_other_errors_are_not_retried(self):
        for error in (
            ClientError("ValidationException", "Filter key scope is not valid"),
            ClientError("AccessDeniedException", "not authorized"),
            RuntimeError("boom"),
        ):
            call = Flaky(error)
            with self.assertRaises(type(error)):
                self.retrieve(call)
            self.assertEqual(call.calls, 1)
        self.assertEqual(self.slept, [])


if __name__ == "__main__":
    unittest.main()
