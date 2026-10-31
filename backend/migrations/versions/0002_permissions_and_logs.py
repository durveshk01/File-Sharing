"""Permissions and access logs schema extension.

Revision ID: 0002_permissions_and_logs
Revises: 0001_initial
Create Date: 2026-10-31
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0002_permissions_and_logs"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    # 1. Add sha256_checksum to files if missing
    if "files" in tables:
        cols = {c["name"] for c in insp.get_columns("files")}
        if "sha256_checksum" not in cols:
            op.add_column("files", sa.Column("sha256_checksum", sa.String(64), nullable=True))

    # 2. file_permissions
    if "file_permissions" not in tables:
        op.create_table(
            "file_permissions",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("granted_by", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("role", sa.String(20), nullable=False, server_default="VIEWER"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_file_permissions_file_id", "file_permissions", ["file_id"])
        op.create_index("ix_file_permissions_email", "file_permissions", ["email"])
        op.create_index("ix_file_permissions_user_id", "file_permissions", ["user_id"])

    # 3. file_access_logs
    if "file_access_logs" not in tables:
        op.create_table(
            "file_access_logs",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=True),
            sa.Column("share_id", sa.String(36), sa.ForeignKey("shares.id", ondelete="CASCADE"), nullable=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
            sa.Column("ip_address", sa.String(45), nullable=True),
            sa.Column("user_agent", sa.String(255), nullable=True),
            sa.Column("action", sa.String(50), nullable=False),
            sa.Column("result", sa.String(20), nullable=False, server_default="success"),
            sa.Column("failure_reason", sa.String(100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_file_access_logs_file_id", "file_access_logs", ["file_id"])
        op.create_index("ix_file_access_logs_share_id", "file_access_logs", ["share_id"])
        op.create_index("ix_file_access_logs_user_id", "file_access_logs", ["user_id"])


def downgrade():
    for name in ("file_access_logs", "file_permissions"):
        try:
            op.drop_table(name)
        except Exception:
            pass
