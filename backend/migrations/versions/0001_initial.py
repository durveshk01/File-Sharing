"""Initial CloudVault schema with safe migration compatibility."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())

    # 1. users
    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("email", sa.String(320), nullable=False),
            sa.Column("password_hash", sa.String(512), nullable=False),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("totp_secret", sa.String(64), nullable=True),
            sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("recovery_codes_hash", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)
    else:
        cols = {c["name"] for c in insp.get_columns("users")}
        if "verified_at" not in cols:
            op.add_column("users", sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True))
        if "totp_secret" not in cols:
            op.add_column("users", sa.Column("totp_secret", sa.String(64), nullable=True))
        if "totp_enabled" not in cols:
            op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")))
        if "recovery_codes_hash" not in cols:
            op.add_column("users", sa.Column("recovery_codes_hash", sa.Text(), nullable=True))

    # 2. sessions
    if "sessions" not in tables:
        op.create_table(
            "sessions",
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_sessions_user_id", "sessions", ["user_id"])

    # 3. files
    if "files" not in tables:
        op.create_table(
            "files",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(120), nullable=False),
            sa.Column("size", sa.Integer(), nullable=False),
            sa.Column("object_key", sa.String(80), nullable=False),
            sa.Column("wrapped_key", sa.LargeBinary(), nullable=False),
            sa.Column("nonce", sa.LargeBinary(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_files_owner_id", "files", ["owner_id"])
        op.create_index("ix_files_object_key", "files", ["object_key"], unique=True)

    # 4. shares
    if "shares" not in tables:
        op.create_table(
            "shares",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("file_id", sa.String(36), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True)),
            sa.Column("max_downloads", sa.Integer()),
            sa.Column("downloads", sa.Integer(), nullable=False, server_default=sa.text("0")),
            sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("password_hash", sa.String(512)),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_shares_file_id", "shares", ["file_id"])
        op.create_index("ix_shares_token_hash", "shares", ["token_hash"], unique=True)

    # 5. activity
    if "activity" not in tables:
        op.create_table(
            "activity",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("action", sa.String(40), nullable=False),
            sa.Column("detail", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_activity_user_id", "activity", ["user_id"])

    # 6. share_grants
    if "share_grants" not in tables:
        op.create_table(
            "share_grants",
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("share_id", sa.String(36), sa.ForeignKey("shares.id", ondelete="CASCADE"), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_share_grants_share_id", "share_grants", ["share_id"])

    # 7. notifications
    if "notifications" not in tables:
        op.create_table(
            "notifications",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("message", sa.String(280), nullable=False),
            sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.text("0")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_notifications_user_id", "notifications", ["user_id"])

    # 8. one_time_tokens
    if "one_time_tokens" not in tables:
        op.create_table(
            "one_time_tokens",
            sa.Column("token_hash", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("purpose", sa.String(24), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("used", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )
        op.create_index("ix_one_time_tokens_user_id", "one_time_tokens", ["user_id"])
        op.create_index("ix_one_time_tokens_purpose", "one_time_tokens", ["purpose"])

    # 9. resumable_uploads
    if "resumable_uploads" not in tables:
        op.create_table(
            "resumable_uploads",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(120), nullable=False),
            sa.Column("total_size", sa.Integer(), nullable=False),
            sa.Column("total_chunks", sa.Integer(), nullable=False),
            sa.Column("completed_chunks", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_resumable_uploads_user_id", "resumable_uploads", ["user_id"])


def downgrade():
    for name in ("resumable_uploads", "one_time_tokens", "notifications", "share_grants", "activity", "shares", "files", "sessions", "users"):
        try:
            op.drop_table(name)
        except Exception:
            pass
