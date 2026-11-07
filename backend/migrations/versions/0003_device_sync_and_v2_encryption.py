"""Device synchronization and v2 client encryption schema extension.

Revision ID: 0003_device_sync_and_v2_encryption
Revises: 0002_permissions_and_logs
Create Date: 2026-11-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_device_sync_and_v2_encryption"
down_revision = "0002_permissions_and_logs"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    # 1. Add versioning and sync columns to files if missing
    if "files" in tables:
        cols = {c["name"] for c in insp.get_columns("files")}
        if "version" not in cols:
            op.add_column("files", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
        if "encryption_version" not in cols:
            op.add_column("files", sa.Column("encryption_version", sa.String(20), nullable=False, server_default="v1"))
        if "ciphertext_sha256" not in cols:
            op.add_column("files", sa.Column("ciphertext_sha256", sa.String(64), nullable=True))
        if "client_modified_at" not in cols:
            op.add_column("files", sa.Column("client_modified_at", sa.DateTime(timezone=True), nullable=True))
        if "is_deleted" not in cols:
            op.add_column("files", sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false" if bind.dialect.name == "postgresql" else "0")))
        if "deleted_at" not in cols:
            op.add_column("files", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))

    # 2. devices table for sync tracking
    if "devices" not in tables:
        op.create_table(
            "devices",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("device_name", sa.String(100), nullable=False),
            sa.Column("device_type", sa.String(20), nullable=False, server_default="mobile"),
            sa.Column("push_token", sa.String(255), nullable=True),
            sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("false" if bind.dialect.name == "postgresql" else "0")),
        )
        op.create_index("ix_devices_user_id", "devices", ["user_id"])

def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "devices" in tables:
        op.drop_table("devices")
