"""Bounded transfer leases and delayed, crash-safe object cleanup."""
from alembic import op
import sqlalchemy as sa

revision = "0006_transfer_leases"
down_revision = "0005_storage_integrity"
branch_labels = None
depends_on = None


def upgrade():
    # ADD COLUMN avoids rebuilding SQLite parents with live foreign-key children.
    for table in ("files", "resumable_uploads"):
        op.add_column(table, sa.Column("transfer_token", sa.String(32), nullable=True))
        op.add_column(table, sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_resumable_user_state", "resumable_uploads", ["user_id", "state"])
    op.add_column("storage_cleanup", sa.Column("not_before", sa.DateTime(timezone=True), nullable=True))
    cleanup = sa.table("storage_cleanup", sa.column("created_at", sa.DateTime(timezone=True)),
                       sa.column("not_before", sa.DateTime(timezone=True)))
    op.get_bind().execute(cleanup.update().values(not_before=cleanup.c.created_at))
    with op.batch_alter_table("storage_cleanup") as batch:
        batch.alter_column("not_before", existing_type=sa.DateTime(timezone=True), nullable=False)
    op.create_index("ix_storage_cleanup_not_before", "storage_cleanup", ["not_before"])


def downgrade():
    op.drop_index("ix_storage_cleanup_not_before", table_name="storage_cleanup")
    op.drop_column("storage_cleanup", "not_before")
    op.drop_index("ix_resumable_user_state", table_name="resumable_uploads")
    for table in ("files", "resumable_uploads"):
        op.drop_column(table, "lease_expires_at")
        op.drop_column(table, "transfer_token")
