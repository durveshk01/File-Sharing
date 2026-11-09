"""Bounded maintenance and transactional cleanup for interrupted transfers."""
import json
import logging
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.file_service import release_storage
from app.models import (
    FileRecord, OneTimeToken, ResumableUpload, SessionRecord, ShareGrant,
    StorageCleanup, StorageGrant, UploadChunk, User,
)
from app.security import as_utc
from app.storage import LocalStorage, StorageAdapter

logger = logging.getLogger("secureshare")


def queue_cleanup(db: Session, key: str, *, not_before: datetime | None = None) -> None:
    event = next((row for row in db.new if isinstance(row, StorageCleanup) and row.object_key == key), None)
    event = event or db.get(StorageCleanup, key)
    deadline = not_before or datetime.now(timezone.utc)
    if event:
        # A still-valid presigned PUT must not recreate an object after cleanup.
        if as_utc(event.not_before) < deadline:
            event.not_before = deadline
    else:
        db.add(StorageCleanup(object_key=key, not_before=deadline))


def chunk_key(upload_id: str, index: int) -> str:
    if not re.fullmatch(r"[a-f0-9-]{36}", upload_id) or index < 0:
        raise ValueError("Invalid resumable object identifier")
    return f"_resumable/{upload_id}/chunk_{index}"


def queue_chunks(db: Session, upload: ResumableUpload, *, now: datetime | None = None) -> None:
    indices = set(db.scalars(select(UploadChunk.chunk_index).where(UploadChunk.upload_id == upload.id)))
    # Also remove pre-migration plaintext chunks in the configured storage root.
    try:
        indices.update(i for i in json.loads(upload.completed_chunks)
                       if isinstance(i, int) and 0 <= i < upload.total_chunks)
    except (TypeError, ValueError):
        pass
    for index in indices:
        queue_cleanup(db, chunk_key(upload.id, index), not_before=now)


def queue_file(db: Session, record: FileRecord, adapter: StorageAdapter, *, now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    queue_cleanup(db, record.object_key, not_before=now)
    if not isinstance(adapter, LocalStorage):
        deadline = as_utc(record.upload_expires_at) if record.upload_expires_at else now
        queue_cleanup(db, f"_pending/{record.object_key}",
                      not_before=deadline + timedelta(seconds=settings.transfer_timeout_seconds + 120))


def drain_cleanup(db: Session, adapter: StorageAdapter, *, now: datetime | None = None, limit: int = 100) -> int:
    now = now or datetime.now(timezone.utc)
    keys = list(db.scalars(select(StorageCleanup.object_key).where(StorageCleanup.not_before <= now)
                           .order_by(StorageCleanup.not_before, StorageCleanup.object_key).limit(limit)))
    cleaned = 0
    for key in keys:
        # Do not remove an object referenced by a live file or upload.
        file = db.scalar(select(FileRecord).where(FileRecord.object_key == key))
        staging = db.scalar(select(FileRecord).where(FileRecord.object_key == key[9:],
                            FileRecord.upload_status != "ready")) if key.startswith("_pending/") else None
        match = re.fullmatch(r"_resumable/([a-f0-9-]{36})/chunk_\d+", key)
        upload = db.get(ResumableUpload, match[1]) if match else None
        if file or staging or upload:
            if file and file.upload_status == "ready":
                db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == key))
            else:
                db.execute(update(StorageCleanup).where(StorageCleanup.object_key == key).values(
                    not_before=now + timedelta(seconds=300)))
            db.commit()
            continue
        db.rollback()  # No database locks are held during object-storage I/O.
        try:
            adapter.delete(key)
            db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == key))
            db.commit()
            cleaned += 1
        except Exception:
            db.rollback()
            db.execute(update(StorageCleanup).where(StorageCleanup.object_key == key).values(
                not_before=now + timedelta(seconds=300)))
            db.commit()
            logger.warning("Object cleanup will be retried", extra={"object_key": key})
    return cleaned


def run_maintenance(db: Session, adapter: StorageAdapter, *, now: datetime | None = None, limit: int = 100) -> dict:
    now = now or datetime.now(timezone.utc)
    for model in (SessionRecord, ShareGrant, StorageGrant, OneTimeToken):
        db.execute(delete(model).where(model.expires_at <= now))
    db.execute(update(FileRecord).where(FileRecord.upload_status == "receiving",
        or_(FileRecord.lease_expires_at.is_(None), FileRecord.lease_expires_at <= now)).values(
            upload_status="pending", transfer_token=None, lease_expires_at=None))
    db.execute(update(ResumableUpload).where(ResumableUpload.state.in_(["receiving", "completing"]),
        or_(ResumableUpload.lease_expires_at.is_(None), ResumableUpload.lease_expires_at <= now)).values(
            state="pending", transfer_token=None, lease_expires_at=None))
    db.commit()

    expired = 0
    file_ids = list(db.execute(select(FileRecord.id, FileRecord.owner_id).where(FileRecord.upload_status != "ready",
        FileRecord.upload_expires_at <= now, or_(FileRecord.lease_expires_at.is_(None), FileRecord.lease_expires_at <= now))
        .order_by(FileRecord.owner_id, FileRecord.id).limit(limit)))
    for file_id, owner_id in file_ids:
        if not claim_owner(db, owner_id):
            db.rollback()
            continue
        record = db.scalar(select(FileRecord).where(FileRecord.id == file_id).execution_options(populate_existing=True))
        if (not record or record.upload_status == "ready" or not record.upload_expires_at
                or as_utc(record.upload_expires_at) > now
                or (record.lease_expires_at and as_utc(record.lease_expires_at) > now)):
            db.rollback()
            continue
        release_storage(db, owner_id, record.size)
        queue_file(db, record, adapter, now=now)
        db.delete(record)
        db.commit()
        expired += 1

    upload_ids = list(db.execute(select(ResumableUpload.id, ResumableUpload.user_id).where(ResumableUpload.expires_at <= now,
        or_(ResumableUpload.lease_expires_at.is_(None), ResumableUpload.lease_expires_at <= now))
        .order_by(ResumableUpload.user_id, ResumableUpload.id).limit(limit)))
    for upload_id, owner_id in upload_ids:
        if not claim_owner(db, owner_id):
            db.rollback()
            continue
        upload = db.scalar(select(ResumableUpload).where(ResumableUpload.id == upload_id).execution_options(populate_existing=True))
        if (not upload or as_utc(upload.expires_at) > now
                or (upload.lease_expires_at and as_utc(upload.lease_expires_at) > now)):
            db.rollback()
            continue
        release_storage(db, owner_id, upload.total_size)
        queue_chunks(db, upload, now=now)
        db.delete(upload)
        db.commit()
        expired += 1

    demo_ids = list(db.scalars(select(User.id).where(User.demo_expires_at <= now).order_by(User.id).limit(limit)))
    deleted_demos = 0
    for user_id in demo_ids:
        claimed = db.execute(update(User).where(User.id == user_id, User.demo_expires_at <= now)
                             .values(storage_reserved_bytes=0))
        if not claimed.rowcount:
            db.rollback()
            continue
        for file in db.scalars(select(FileRecord).where(FileRecord.owner_id == user_id)):
            queue_file(db, file, adapter, now=now)
        for upload in db.scalars(select(ResumableUpload).where(ResumableUpload.user_id == user_id)):
            queue_chunks(db, upload, now=now)
        db.execute(delete(User).where(User.id == user_id))
        db.commit()
        deleted_demos += 1
    return {"expired_uploads": expired, "expired_demo_accounts": deleted_demos,
            "cleaned_objects": drain_cleanup(db, adapter, now=now, limit=limit)}


def claim_owner(db: Session, user_id: str) -> bool:
    """Serialize cleanup with quota mutations before re-reading transfer state."""
    result = db.execute(update(User).where(User.id == user_id).values(
        storage_reserved_bytes=User.storage_reserved_bytes).execution_options(synchronize_session=False))
    return result.rowcount == 1
