"""Upload state, scoped transfers, quota reservations and durable sync/audit data."""
import base64
from collections import defaultdict
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0005_storage_integrity"
down_revision = "0004_session_security"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    false = sa.text("false" if bind.dialect.name == "postgresql" else "0")
    op.add_column("users", sa.Column("storage_reserved_bytes", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("sync_sequence", sa.BigInteger(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("demo_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_users_demo_expires_at", "users", ["demo_expires_at"])
    op.add_column("files", sa.Column("upload_status", sa.String(16), nullable=False, server_default="ready"))
    op.add_column("files", sa.Column("ciphertext_size", sa.BigInteger(), nullable=True))
    op.add_column("files", sa.Column("upload_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_files_upload_expires_at", "files", ["upload_expires_at"])
    op.create_index("ix_files_owner_state_created", "files", ["owner_id", "upload_status", "is_deleted", "created_at"])
    op.add_column("resumable_uploads", sa.Column("state", sa.String(16), nullable=False, server_default="pending"))
    op.add_column("resumable_uploads", sa.Column("received_bytes", sa.BigInteger(), nullable=False, server_default="0"))
    op.create_table(
        "upload_chunks",
        sa.Column("upload_id", sa.String(36), sa.ForeignKey("resumable_uploads.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("chunk_index", sa.Integer(), primary_key=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("wrapped_key", sa.LargeBinary(), nullable=False),
    )
    op.create_table(
        "file_changes",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("sequence", sa.BigInteger(), primary_key=True),
        sa.Column("payload", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_file_changes_created_at", "file_changes", ["created_at"])
    op.create_table(
        "storage_grants",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_hash", sa.String(64), sa.ForeignKey("sessions.token_hash", ondelete="CASCADE"), nullable=True),
        sa.Column("share_id", sa.String(36), sa.ForeignKey("shares.id", ondelete="CASCADE"), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed", sa.Boolean(), nullable=False, server_default=false),
    )
    for column in ("file_id", "session_hash", "share_id", "expires_at"):
        op.create_index(f"ix_storage_grants_{column}", "storage_grants", [column])
    op.create_table("storage_cleanup", sa.Column("object_key", sa.String(120), primary_key=True),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_storage_cleanup_created_at", "storage_cleanup", ["created_at"])

    # Retain historical audit subjects when parent files/shares are removed.
    op.add_column("file_access_logs", sa.Column("owner_id", sa.String(36), nullable=True))
    op.add_column("file_access_logs", sa.Column("subject_file_id", sa.String(36), nullable=True))
    op.add_column("file_access_logs", sa.Column("subject_share_id", sa.String(36), nullable=True))
    metadata = sa.MetaData()
    files = sa.Table("files", metadata, autoload_with=bind)
    users = sa.Table("users", metadata, autoload_with=bind)
    uploads = sa.Table("resumable_uploads", metadata, autoload_with=bind)
    shares = sa.Table("shares", metadata, autoload_with=bind)
    logs = sa.Table("file_access_logs", metadata, autoload_with=bind)
    bind.execute(logs.update().values(subject_file_id=logs.c.file_id, subject_share_id=logs.c.share_id,
        owner_id=sa.select(files.c.owner_id).where(files.c.id == logs.c.file_id).scalar_subquery()))
    for column, parent, primary in ((logs.c.file_id, files, files.c.id), (logs.c.share_id, shares, shares.c.id), (logs.c.user_id, users, users.c.id)):
        bind.execute(logs.update().where(column.is_not(None), ~sa.exists(sa.select(primary).where(primary == column))).values({column.name: None}))
    convention = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}
    constraints = sa.inspect(bind).get_foreign_keys("file_access_logs")
    with op.batch_alter_table("file_access_logs", naming_convention=convention) as batch:
        for constraint in constraints:
            column = constraint["constrained_columns"][0]
            name = constraint["name"] or f"fk_file_access_logs_{column}_{constraint['referred_table']}"
            batch.drop_constraint(name, type_="foreignkey")
            batch.create_foreign_key(name, constraint["referred_table"], [column], constraint["referred_columns"], ondelete="SET NULL")
        batch.create_foreign_key("fk_file_access_logs_owner_id_users", "users", ["owner_id"], ["id"], ondelete="CASCADE")
        batch.create_index("ix_file_access_logs_owner_id", ["owner_id"])

    file_size = sa.select(sa.func.coalesce(sa.func.sum(files.c.size), 0)).where(files.c.owner_id == users.c.id).scalar_subquery()
    pending_size = sa.select(sa.func.coalesce(sa.func.sum(uploads.c.total_size), 0)).where(uploads.c.user_id == users.c.id).scalar_subquery()
    bind.execute(users.update().values(storage_reserved_bytes=file_size + pending_size))
    bind.execute(files.update().values(ciphertext_size=files.c.size + 16))

    # Seed the journal from existing records; no files or encryption keys change.
    changes = sa.Table("file_changes", sa.MetaData(), autoload_with=bind)
    sequences = defaultdict(int)
    timestamp = datetime.now(timezone.utc)
    for file in bind.execute(sa.select(files).order_by(files.c.owner_id, files.c.created_at, files.c.id)).mappings():
        owner = file["owner_id"]
        sequences[owner] += 1
        payload = {key: file[key] for key in ("id", "name", "size", "content_type", "sha256_checksum", "ciphertext_sha256", "version", "encryption_version", "is_deleted")}
        payload["nonce_b64"] = base64.b64encode(file["nonce"]).decode()
        for key in ("created_at", "client_modified_at"):
            value = file[key]
            payload[key] = value.isoformat() if value else None
        bind.execute(changes.insert().values(user_id=owner, sequence=sequences[owner], payload=payload, created_at=timestamp))
    for user_id, sequence in sequences.items():
        bind.execute(users.update().where(users.c.id == user_id).values(sync_sequence=sequence))


def downgrade():
    raise RuntimeError("Storage-integrity migration requires a backed-up roll-forward recovery; destructive downgrade is unsupported")
