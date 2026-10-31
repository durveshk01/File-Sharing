import base64
import os
import secrets
import shutil
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

# Test storage directory
test_storage_dir = Path(__file__).resolve().parent / "_test_storage"
if test_storage_dir.exists():
    shutil.rmtree(test_storage_dir, ignore_errors=True)
test_storage_dir.mkdir(parents=True, exist_ok=True)

os.environ["KEK_BASE64"] = base64.b64encode(secrets.token_bytes(32)).decode()
os.environ["APP_SECRET"] = secrets.token_hex(32)
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["STORAGE_PATH"] = str(test_storage_dir)
os.environ["STORAGE_BACKEND"] = "local"
os.environ["MAIL_MODE"] = "console"
os.environ["RUN_MIGRATIONS_ON_START"] = "false"

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, get_db
from app.main import app as fastapi_app, sent_emails
from app import models

# In-memory test engine with StaticPool so all sessions share the DB in memory
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=test_engine, autoflush=False, expire_on_commit=False)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

fastapi_app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_database():
    Base.metadata.create_all(bind=test_engine)
    sent_emails.clear()
    yield
    Base.metadata.drop_all(bind=test_engine)
    if test_storage_dir.exists():
        shutil.rmtree(test_storage_dir, ignore_errors=True)
        test_storage_dir.mkdir(parents=True, exist_ok=True)

@pytest.fixture
def client():
    return TestClient(fastapi_app)

@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
