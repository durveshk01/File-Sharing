import gc
import tempfile
from pathlib import Path
import sqlite3
from alembic.config import Config
from alembic import command

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

        for expected in ("users", "files", "shares", "sessions", "activity", "one_time_tokens", "resumable_uploads"):
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
