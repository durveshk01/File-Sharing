"""Bind sessions to devices and encrypt stored TOTP secrets without rotating keys."""
from alembic import op
import sqlalchemy as sa

from app.encryption import protect_totp_secret

revision = "0004_session_security"
down_revision = "0003_device_sync_and_v2_encryption"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    # SQLite does not enforce VARCHAR length. Avoid rebuilding a parent table
    # with live foreign keys; PostgreSQL needs an actual unbounded text column.
    if bind.dialect.name != "sqlite":
        op.alter_column("users", "totp_secret", existing_type=sa.String(64), type_=sa.Text(), existing_nullable=True)
    users = sa.table("users", sa.column("id", sa.String), sa.column("totp_secret", sa.Text))
    for user_id, secret in bind.execute(sa.select(users.c.id, users.c.totp_secret).where(users.c.totp_secret.is_not(None))):
        if secret and not secret.startswith("enc:v1:"):
            bind.execute(users.update().where(users.c.id == user_id).values(totp_secret=protect_totp_secret(secret)))
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("device_id", sa.String(36), nullable=True))
        batch.create_foreign_key("fk_sessions_device_id_devices", "devices", ["device_id"], ["id"], ondelete="SET NULL")
        batch.create_index("ix_sessions_device_id", ["device_id"])


def downgrade():
    # Encrypted TOTP values intentionally stay encrypted and are never truncated.
    with op.batch_alter_table("sessions") as batch:
        batch.drop_index("ix_sessions_device_id")
        batch.drop_constraint("fk_sessions_device_id_devices", type_="foreignkey")
        batch.drop_column("device_id")
