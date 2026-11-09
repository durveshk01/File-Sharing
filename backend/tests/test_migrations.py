import gc
import tempfile
from pathlib import Path
import sqlite3
import base64
from datetime import datetime, timedelta, timezone
import hashlib
from alembic.config import Config
from alembic import command
import sqlalchemy as sa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.encryption import decrypt_file, encrypt_file, reveal_totp_secret

def test_migration_on_clean_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    try:
        backend_dir = Path(__file__).resolve().parents[1]
        alembic_cfg = Config(str(backend_dir / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(backend_dir / "migrations"))
        alembic_cfg.set_main_option("sqlalchemy.url", f"sqlite:///{Path(db_path).as_posix()}")

        # Run upgrade head
        command.upgrade(alembic_cfg, "head")

        # Verify tables exist
        conn = sqlite3.connect(db_path)
        tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        conn.close()

        for expected in ("users", "files", "shares", "sessions", "activity", "one_time_tokens", "resumable_uploads", "devices"):
            assert expected in tables, f"Expected {expected} in {tables}"
    finally:
        gc.collect()
        Path(db_path).unlink(missing_ok=True)

def test_migration_on_pre_existing_legacy_db():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name

    try:
        # Pre-populate legacy database before migrations were introduced
        conn = sqlite3.connect(db_path)
        conn.execute("""
            CREATE TABLE users (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                email VARCHAR(320) NOT NULL,
                password_hash VARCHAR(512) NOT NULL,
                created_at DATETIME NOT NULL
            )
        """)
        conn.execute("INSERT INTO users VALUES ('u1', 'Legacy User', 'legacy@example.com', 'hash123', '2026-01-01 00:00:00')")
        conn.commit()
        conn.close()

        backend_dir = Path(__file__).resolve().parents[1]
        alembic_cfg = Config(str(backend_dir / "alembic.ini"))
        alembic_cfg.set_main_option("script_location", str(backend_dir / "migrations"))
        alembic_cfg.set_main_option("sqlalchemy.url", f"sqlite:///{Path(db_path).as_posix()}")

        # Upgrade head on existing DB
        command.upgrade(alembic_cfg, "head")

        # Verify existing data is preserved and new columns/tables exist
        conn = sqlite3.connect(db_path)
        user_row = conn.execute("SELECT id, name, email, totp_enabled FROM users WHERE id='u1'").fetchone()
        assert user_row is not None
        assert user_row[0] == "u1"
        assert user_row[1] == "Legacy User"
        assert user_row[2] == "legacy@example.com"
        assert user_row[3] == 0  # default totp_enabled

        tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        assert "one_time_tokens" in tables
        assert "resumable_uploads" in tables
        conn.close()
    finally:
        gc.collect()
        Path(db_path).unlink(missing_ok=True)


def test_populated_upgrade_preserves_encryption_links_and_audit_history(tmp_path):
    backend_dir = Path(__file__).resolve().parents[1]
    url = f"sqlite:///{(tmp_path / 'populated.db').as_posix()}"
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0003_device_sync_and_v2_encryption")
    engine = sa.create_engine(url)
    now = datetime.now(timezone.utc)
    plaintext = b"An existing private file"
    ciphertext, nonce, wrapped_key = encrypt_file(plaintext)
    device_plain = b"\x00\xff\x80device file"
    device_nonce = b"123456789012"
    device_cipher = AESGCM(b"k" * 32).encrypt(device_nonce, device_plain, b"secureshare:file:v2")
    metadata = sa.MetaData()
    metadata.reflect(bind=engine)
    try:
        with engine.begin() as connection:
            connection.execute(metadata.tables["users"].insert(), [
                {"id": "owner", "name": "Owner", "email": "owner@example.com", "password_hash": "existing-hash",
                 "totp_secret": "JBSWY3DPEHPK3PXP", "totp_enabled": True, "created_at": now},
                {"id": "collaborator", "name": "Collaborator", "email": "reader@example.com", "password_hash": "another-hash",
                 "totp_secret": None, "totp_enabled": False, "created_at": now},
            ])
            connection.execute(metadata.tables["files"].insert(), [
                {"id": "legacy-file", "owner_id": "owner", "name": "legacy.txt", "content_type": "text/plain",
                 "size": len(plaintext), "object_key": "a" * 64, "nonce": nonce, "wrapped_key": wrapped_key,
                 "sha256_checksum": hashlib.sha256(plaintext).hexdigest(), "ciphertext_sha256": hashlib.sha256(ciphertext).hexdigest(),
                 "encryption_version": "v1", "created_at": now},
                {"id": "device-file", "owner_id": "owner", "name": "device.bin", "content_type": "application/octet-stream",
                 "size": len(device_plain), "object_key": "b" * 64, "nonce": device_nonce, "wrapped_key": b"",
                 "sha256_checksum": hashlib.sha256(device_plain).hexdigest(), "ciphertext_sha256": hashlib.sha256(device_cipher).hexdigest(),
                 "encryption_version": "v2", "created_at": now},
            ])
            connection.execute(metadata.tables["shares"].insert().values(
                id="existing-share", file_id="legacy-file", token_hash="s" * 64, downloads=2, created_at=now))
            connection.execute(metadata.tables["sessions"].insert().values(
                token_hash="t" * 64, user_id="owner", expires_at=now + timedelta(days=1)))
            connection.execute(metadata.tables["file_permissions"].insert().values(
                id="permission", file_id="legacy-file", user_id="collaborator", granted_by="owner",
                email="reader@example.com", role="EDITOR", created_at=now))
            connection.execute(metadata.tables["file_access_logs"].insert().values(
                id="existing-log", file_id="legacy-file", share_id="existing-share", user_id="collaborator",
                action="file.downloaded", created_at=now))
            connection.execute(metadata.tables["resumable_uploads"].insert().values(
                id="unfinished", user_id="owner", name="pending.txt", content_type="text/plain", total_size=8,
                total_chunks=2, created_at=now, expires_at=now + timedelta(hours=1)))

        command.upgrade(config, "0005_storage_integrity")
        cleanup = sa.Table("storage_cleanup", sa.MetaData(), autoload_with=engine)
        with engine.begin() as connection:
            connection.execute(cleanup.insert().values(object_key="c" * 64, created_at=now))
        command.upgrade(config, "head")
        metadata = sa.MetaData()
        metadata.reflect(bind=engine)
        with engine.begin() as connection:
            owner = connection.execute(sa.select(metadata.tables["users"]).where(
                metadata.tables["users"].c.id == "owner")).mappings().one()
            assert owner["password_hash"] == "existing-hash" and owner["totp_enabled"]
            assert owner["totp_secret"].startswith("enc:v1:")
            assert reveal_totp_secret(owner["totp_secret"]) == "JBSWY3DPEHPK3PXP"
            assert owner["storage_reserved_bytes"] == len(plaintext) + len(device_plain) + 8
            assert owner["sync_sequence"] == 2
            files = {row["id"]: row for row in connection.execute(sa.select(metadata.tables["files"])).mappings()}
            assert files["legacy-file"]["object_key"] == "a" * 64
            assert decrypt_file(ciphertext, files["legacy-file"]["nonce"], files["legacy-file"]["wrapped_key"]) == plaintext
            assert files["device-file"]["nonce"] == device_nonce and files["device-file"]["wrapped_key"] == b""
            assert files["device-file"]["ciphertext_size"] == len(device_cipher)
            changes = list(connection.execute(sa.select(metadata.tables["file_changes"]).order_by(
                metadata.tables["file_changes"].c.sequence)).mappings())
            assert {row["payload"]["id"] for row in changes} == set(files)
            assert all(row["payload"]["nonce_b64"] == base64.b64encode(files[row["payload"]["id"]]["nonce"]).decode() for row in changes)
            cleanup_row = connection.execute(sa.select(metadata.tables["storage_cleanup"])).mappings().one()
            assert cleanup_row["not_before"] == cleanup_row["created_at"]
            assert connection.scalar(sa.select(metadata.tables["shares"].c.downloads)) == 2
            assert connection.scalar(sa.select(metadata.tables["file_permissions"].c.role)) == "EDITOR"
            connection.execute(metadata.tables["files"].delete().where(metadata.tables["files"].c.id == "legacy-file"))
            log = connection.execute(sa.select(metadata.tables["file_access_logs"])).mappings().one()
            assert log["file_id"] is None and log["share_id"] is None
            assert log["owner_id"] == "owner" and log["subject_file_id"] == "legacy-file"
            assert log["subject_share_id"] == "existing-share" and log["user_id"] == "collaborator"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    finally:
        engine.dispose()
