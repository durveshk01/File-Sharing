from datetime import datetime, timezone
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, JSON, LargeBinary, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

def now():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    totp_secret: Mapped[str | None] = mapped_column(Text, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    recovery_codes_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    storage_reserved_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    sync_sequence: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    demo_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    files: Mapped[list["FileRecord"]] = relationship(back_populates="owner", passive_deletes=True)
    devices: Mapped[list["DeviceRecord"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class SessionRecord(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    device_id: Mapped[str | None] = mapped_column(ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True)

class DeviceRecord(Base):
    __tablename__ = "devices"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_name: Mapped[str] = mapped_column(String(100))
    device_type: Mapped[str] = mapped_column(String(20), default="mobile")  # mobile, web, desktop
    push_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    user: Mapped["User"] = relationship(back_populates="devices")

class FileRecord(Base):
    __tablename__ = "files"
    __table_args__ = (Index("ix_files_owner_state_created", "owner_id", "upload_status", "is_deleted", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer)
    object_key: Mapped[str] = mapped_column(String(80), unique=True)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    sha256_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    version: Mapped[int] = mapped_column(Integer, default=1)
    encryption_version: Mapped[str] = mapped_column(String(20), default="v1")  # v1=server envelope, v2=device client encrypted
    ciphertext_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    upload_status: Mapped[str] = mapped_column(String(16), default="ready", server_default="ready")
    ciphertext_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    upload_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    transfer_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner: Mapped[User] = relationship(back_populates="files")

class ShareLink(Base):
    __tablename__ = "shares"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_downloads: Mapped[int | None] = mapped_column(Integer, nullable=True)
    downloads: Mapped[int] = mapped_column(Integer, default=0)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(40))
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class ShareGrant(Base):
    """Short-lived, hashed proof that a password-protected link was verified."""
    __tablename__ = "share_grants"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    share_id: Mapped[str] = mapped_column(ForeignKey("shares.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(String(280))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class OneTimeToken(Base):
    __tablename__ = "one_time_tokens"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(24), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used: Mapped[bool] = mapped_column(Boolean, default=False)

class ResumableUpload(Base):
    __tablename__ = "resumable_uploads"
    __table_args__ = (Index("ix_resumable_user_state", "user_id", "state"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    total_size: Mapped[int] = mapped_column(Integer)
    total_chunks: Mapped[int] = mapped_column(Integer)
    completed_chunks: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    state: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    received_bytes: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0")
    transfer_token: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class UploadChunk(Base):
    __tablename__ = "upload_chunks"
    upload_id: Mapped[str] = mapped_column(ForeignKey("resumable_uploads.id", ondelete="CASCADE"), primary_key=True)
    chunk_index: Mapped[int] = mapped_column(Integer, primary_key=True)
    size: Mapped[int] = mapped_column(Integer)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary)


class FileChange(Base):
    """Per-account, commit-ordered change journal, including deletion tombstones."""
    __tablename__ = "file_changes"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    sequence: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)


class StorageGrant(Base):
    """Scoped, short-lived ciphertext authorization; a shared transfer is counted once."""
    __tablename__ = "storage_grants"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    session_hash: Mapped[str | None] = mapped_column(ForeignKey("sessions.token_hash", ondelete="CASCADE"), nullable=True, index=True)
    share_id: Mapped[str | None] = mapped_column(ForeignKey("shares.id", ondelete="CASCADE"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class StorageCleanup(Base):
    """Transactional outbox for object deletions, retried by maintenance."""
    __tablename__ = "storage_cleanup"
    object_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, index=True)

class FilePermission(Base):
    __tablename__ = "file_permissions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    granted_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(20), default="VIEWER")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class FileAccessLog(Base):
    __tablename__ = "file_access_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    file_id: Mapped[str | None] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"), nullable=True, index=True)
    share_id: Mapped[str | None] = mapped_column(ForeignKey("shares.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    subject_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    subject_share_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    result: Mapped[str] = mapped_column(String(20), default="success")
    failure_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
