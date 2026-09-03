"""
Test configuration — sets up environment variables for tests to run without
a live database or AWS connection.
"""
import os
import pytest

# Set test environment variables before any app imports
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-unit-tests-only-32chars!")
os.environ.setdefault("AWS_S3_BUCKET", "")
os.environ.setdefault("ENVIRONMENT", "test")
