"""Shared file authorization, quota accounting and commit-ordered synchronization."""
import base64
import re
from pathlib import PurePosixPath
from urllib.parse import quote

from fastapi import HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import FileChange, FilePermission, FileRecord, ResumableUpload, User


def clean_filename(value: str) -> str:
    name = PurePosixPath(value.replace("\\", "/")).name
    return re.sub(r"[\x00-\x1f\x7f]", "", name).strip()[:255] or "file"


def content_disposition(name: str) -> str:
    name = clean_filename(name)
    fallback = name.encode("ascii", "ignore").decode().replace('"', "").replace("\\", "") or "download"
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(name, safe="")}'


def safe_file(f: FileRecord) -> dict:
    return {
        "id": f.id, "name": f.name, "size": f.size, "content_type": f.content_type,
        "sha256_checksum": f.sha256_checksum, "ciphertext_sha256": f.ciphertext_sha256,
        "version": f.version, "encryption_version": f.encryption_version,
        "nonce_b64": base64.b64encode(f.nonce).decode(),
        "client_modified_at": f.client_modified_at.isoformat() if f.client_modified_at else None,
        "is_deleted": f.is_deleted, "created_at": f.created_at.isoformat(),
    }


def owned_file(file_id: str, user: User, db: Session, *, include_pending: bool = False, include_trash: bool = False) -> FileRecord:
    query = select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id)
    if not include_pending:
        query = query.where(FileRecord.upload_status == "ready")
    if not include_trash:
        query = query.where(FileRecord.is_deleted.is_(False))
    record = db.scalar(query)
    if not record:
        raise HTTPException(404, "File not found")
    return record


def readable_file(file_id: str, user: User, db: Session, *, edit: bool = False) -> FileRecord:
    record = db.scalar(select(FileRecord).where(
        FileRecord.id == file_id, FileRecord.is_deleted.is_(False), FileRecord.upload_status == "ready"
    ))
    if record and record.owner_id == user.id:
        return record
    permission = db.scalar(select(FilePermission).where(
        FilePermission.file_id == file_id,
        or_(FilePermission.user_id == user.id, FilePermission.email == user.email),
    )) if record else None
    if not permission:
        raise HTTPException(404, "File not found")
    if edit and permission.role != "EDITOR":
        raise HTTPException(403, "Editor permission is required")
    return record


def reserve_storage(db: Session, user_id: str, size: int) -> None:
    result = db.execute(update(User).where(
        User.id == user_id, User.storage_reserved_bytes + size <= settings.account_quota_bytes
    ).values(storage_reserved_bytes=User.storage_reserved_bytes + size))
    if result.rowcount != 1:
        raise HTTPException(413, "Account storage quota exceeded. Empty trash or remove unused uploads to free space")


def release_storage(db: Session, user_id: str, size: int) -> None:
    result = db.execute(update(User).where(User.id == user_id, User.storage_reserved_bytes >= size).values(
        storage_reserved_bytes=User.storage_reserved_bytes - size
    ))
    if result.rowcount != 1:
        raise RuntimeError("Storage reservation is inconsistent; refusing to make quota negative")


def check_pending_limit(db: Session, user_id: str) -> None:
    # Call after reserve_storage(), while its account-row lock is held.
    files = db.scalar(select(func.count()).select_from(FileRecord).where(
        FileRecord.owner_id == user_id, FileRecord.upload_status != "ready"))
    uploads = db.scalar(select(func.count()).select_from(ResumableUpload).where(ResumableUpload.user_id == user_id))
    if files + uploads >= settings.max_pending_uploads:
        raise HTTPException(429, "Too many unfinished uploads. Finish or cancel an existing upload first")


def next_change_sequence(db: Session, user_id: str) -> int:
    # Updating one account row orders commits; global auto-increment IDs alone
    # can skip changes when a lower-numbered transaction commits later.
    return db.scalar(update(User).where(User.id == user_id).values(
        sync_sequence=User.sync_sequence + 1
    ).returning(User.sync_sequence))


def record_change(db: Session, record: FileRecord, *, sequence: int | None = None, removed: bool = False) -> None:
    sequence = sequence if sequence is not None else next_change_sequence(db, record.owner_id)
    db.flush()
    payload = safe_file(record)
    if removed:
        payload["is_deleted"] = True
        payload["permanently_deleted"] = True
    db.add(FileChange(user_id=record.owner_id, sequence=sequence, payload=payload))


def parse_range(header: str | None, size: int) -> tuple[int, int, int]:
    if not header:
        return 0, size - 1, 200
    match = re.fullmatch(r"bytes=(\d{0,20})-(\d{0,20})", header)
    if not match or not any(match.groups()):
        raise HTTPException(416, "Only a valid single byte range is supported", headers={"Content-Range": f"bytes */{size}"})
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
    else:
        suffix = int(last)
        start, end = max(0, size - suffix), size - 1
        if suffix == 0:
            start = size
    if start >= size or start > end:
        raise HTTPException(416, "Requested range is not satisfiable", headers={"Content-Range": f"bytes */{size}"})
    return start, end, 206
