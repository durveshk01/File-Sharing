import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import secrets
import smtplib
import threading
import uuid
from contextlib import asynccontextmanager, suppress
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

import anyio
from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import SessionLocal, get_db
from app.encryption import _kek, decrypt_file, encrypt_file, protect_totp_secret, reveal_totp_secret
from app.file_service import (
    check_pending_limit, clean_filename, content_disposition, next_change_sequence, owned_file,
    parse_range, readable_file, record_change, release_storage, reserve_storage, safe_file,
)
from app.mime_validator import validate_file_content
from app.models import (
    Activity,
    DeviceRecord,
    FileAccessLog,
    FileChange,
    FilePermission,
    FileRecord,
    Notification,
    OneTimeToken,
    ResumableUpload,
    SessionRecord,
    ShareGrant,
    ShareLink,
    StorageGrant,
    StorageCleanup,
    UploadChunk,
    User,
)
from app.security import (
    COOKIE,
    as_utc,
    clear_session_cookie,
    current_user,
    digest,
    hash_password,
    issue_session,
    session_token,
    verify_password,
)
from app.storage import LocalStorage, storage
from app.maintenance import chunk_key, drain_cleanup, queue_chunks, queue_cleanup, queue_file, run_maintenance
from app.totp import (
    generate_recovery_codes,
    generate_totp_secret,
    get_provisioning_uri,
    hash_recovery_code,
    verify_recovery_code,
    verify_totp_code,
)

Path("./data").mkdir(exist_ok=True)
Path(settings.storage_path).mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("secureshare")


def migrate_database():
    if settings.run_migrations_on_start:
        from alembic import command
        from alembic.config import Config
        backend = Path(__file__).resolve().parent.parent
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "migrations"))
        config.set_main_option("sqlalchemy.url", settings.normalized_database_url.replace("%", "%%"))
        command.upgrade(config, "head")  # Migration failures stop startup.


def maintenance_tick():
    with SessionLocal() as db:
        run_maintenance(db, storage)


async def maintenance_loop():
    while True:
        await asyncio.sleep(settings.maintenance_interval_seconds)
        try:
            await run_in_threadpool(maintenance_tick)
        except Exception:
            logger.exception("Maintenance failed; it will be retried")


@asynccontextmanager
async def lifespan(application: FastAPI):
    _kek()  # Validate encoding/length before serving encryption or TOTP requests.
    await run_in_threadpool(migrate_database)
    task = asyncio.create_task(maintenance_loop()) if settings.maintenance_interval_seconds > 0 else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="SecureShare API", version="1.1.0", lifespan=lifespan)
origins = [o.strip() for o in settings.frontend_origin.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

_rate_guard = threading.Lock()
_attempts = {}

# Test/console mail log for inspections and integration verification
sent_emails = []
@app.middleware("http")
async def auth_rate_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if (origin and origin.rstrip("/") not in origins) or (
            not origin and request.headers.get("sec-fetch-site") == "cross-site"
        ):
            return Response('Untrusted request origin', status_code=403)
    throttled_paths = (
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/verify-email",
        "/api/auth/login/2fa",
        "/api/auth/demo",
        "/api/auth/resend-verification",
        "/api/auth/2fa/setup",
        "/api/auth/2fa/enable",
        "/api/auth/2fa/disable",
        "/api/storage/upload-intent",
        "/api/files/resumable/init",
    )
    if request.url.path in throttled_paths or re.fullmatch(r"/api/(?:public/)?shares/[^/]+/verify", request.url.path):
        ip = request.client.host if request.client else "unknown"
        key = (ip, request.url.path)
        now_ts = datetime.now(timezone.utc).timestamp()
        with _rate_guard:
            events = [t for t in _attempts.get(key, []) if now_ts - t < 60]
            if len(events) >= 30:
                return Response("Too many requests", status_code=429)
            events.append(now_ts)
            _attempts[key] = events
    return await call_next(request)

# Pydantic Schemas
class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class Login2FAIn(BaseModel):
    challenge_token: str
    code: str

class TOTPEnableIn(BaseModel):
    code: str

class TOTPDisableIn(BaseModel):
    password: str
    code: str

class ShareIn(BaseModel):
    expires_in_hours: int | None = Field(default=None, ge=1, le=720)
    max_downloads: int | None = Field(default=None, ge=1, le=1000)
    password: str | None = Field(default=None, min_length=8, max_length=128)

class ShareUpdateIn(BaseModel):
    expires_in_hours: int | None = Field(default=None, ge=1, le=720)
    max_downloads: int | None = Field(default=None, ge=1, le=1000)
    password: str | None = Field(default=None, min_length=8, max_length=128)
    revoked: bool | None = None

class PermissionIn(BaseModel):
    email: EmailStr
    role: str = Field(default="VIEWER", pattern="^(VIEWER|EDITOR)$")

class PermissionUpdateIn(BaseModel):
    role: str = Field(pattern="^(VIEWER|EDITOR)$")

class EncryptionMetadataVerifyIn(BaseModel):
    sha256_checksum: str | None = None

class ShareVerify(BaseModel):
    password: str

class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=12, max_length=128)

class EmailIn(BaseModel):
    email: EmailStr

class TokenIn(BaseModel):
    token: str
    new_password: str | None = Field(default=None, min_length=12, max_length=128)

class ResumableInitIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    content_type: str = Field(default="application/octet-stream", max_length=120, pattern=r"^[\x20-\x7e]+$")
    total_chunks: int = Field(ge=1, le=5000)

class UploadIntentIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    ciphertext_size: int = Field(gt=0)
    content_type: str = Field(default="application/octet-stream", max_length=120, pattern=r"^[\x20-\x7e]+$")
    sha256_checksum: str = Field(pattern=r"^[a-f0-9]{64}$")
    ciphertext_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    nonce_b64: str = Field(min_length=16, max_length=16)
    wrapped_key_b64: str = Field(default="", max_length=0)
    encryption_version: str = Field(default="v2", pattern=r"^v2$")
    device_id: str | None = None

class ConfirmUploadIn(BaseModel):
    ciphertext_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    device_id: str | None = None

class DeviceRegisterIn(BaseModel):
    device_id: str = Field(min_length=1, max_length=36)
    device_name: str = Field(min_length=1, max_length=100)
    device_type: str = Field(default="mobile", pattern="^(mobile|web|desktop)$")
    push_token: str | None = None

class SyncRenameIn(BaseModel):
    file_id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=255)
    version: int = Field(default=1, ge=1)

class SyncDeleteIn(BaseModel):
    file_id: str = Field(min_length=1, max_length=36)
    version: int = Field(default=1, ge=1)

class SyncBatchIn(BaseModel):
    device_id: str | None = None
    renames: list[SyncRenameIn] = Field(default_factory=list, max_length=100)
    deletions: list[SyncDeleteIn] = Field(default_factory=list, max_length=100)

class FileUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    version: int | None = Field(default=None, ge=1)

def send_email(to: str, subject: str, body: str):
    if settings.mail_mode == "console":
        del sent_emails[:-99]
        sent_emails.append({"to": to, "subject": subject, "body": body})
        print(f"[mail:console] to={to} subject={subject} body={body}")
        return
    if not settings.smtp_host:
        raise RuntimeError("SMTP_HOST is required when MAIL_MODE=smtp")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.mail_from
    message["To"] = to
    message.set_content(body)
    
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(message)

def issue_one_time(db: Session, user: User, purpose: str) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(
        OneTimeToken(
            token_hash=digest(raw),
            user_id=user.id,
            purpose=purpose,
            expires_at=datetime.now(timezone.utc) + (
                timedelta(minutes=5) if purpose == "2fa_challenge" else timedelta(hours=24 if purpose == "verify" else 1)
            ),
        )
    )
    db.flush()
    return raw

def activity(db: Session, user: User, action: str, detail: str):
    db.add(Activity(id=str(uuid.uuid4()), user_id=user.id, action=action, detail=detail))

def notify(db: Session, user: User, message: str):
    db.add(Notification(id=str(uuid.uuid4()), user_id=user.id, message=message))

def record_access_log(
    db: Session,
    action: str,
    file_id: str | None = None,
    share_id: str | None = None,
    user_id: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    result: str = "success",
    failure_reason: str | None = None,
    owner_id: str | None = None,
):
    # Flush new parents before audit inserts and preserve subjects after deletion.
    db.flush()
    file = db.get(FileRecord, file_id) if file_id else None
    share = db.get(ShareLink, share_id) if share_id else None
    entry = FileAccessLog(
        id=str(uuid.uuid4()),
        file_id=file.id if file else None,
        share_id=share.id if share else None,
        subject_file_id=file_id,
        subject_share_id=share_id,
        owner_id=owner_id or (file.owner_id if file else None),
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent[:255] if user_agent else None,
        action=action,
        result=result,
        failure_reason=failure_reason,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)

def valid_share(s: ShareLink):
    return bool(
        s
        and not s.revoked
        and (not s.expires_at or as_utc(s.expires_at) > datetime.now(timezone.utc))
        and (not s.max_downloads or s.downloads < s.max_downloads)
    )

@app.get("/")
def root():
    return {
        "service": "SecureShare API",
        "status": "online",
        "version": app.version,
        "docs": "/docs",
        "health": "/health",
    }

@app.get("/health")
def health(response: Response, db: Session = Depends(get_db)):
    checks = {"database": "ok", "storage": "ok"}
    try:
        db.execute(select(User.id, User.sync_sequence).limit(1))
        db.execute(select(FileRecord.upload_status, FileRecord.lease_expires_at).limit(1))
    except Exception:
        db.rollback()
        checks["database"] = "unavailable"
    try:
        storage.check_health()
    except Exception:
        checks["storage"] = "unavailable"
    healthy = all(value == "ok" for value in checks.values())
    response.status_code = 200 if healthy else 503
    return {"status": "ok" if healthy else "unavailable", **checks}

@app.post("/api/auth/demo")
def demo_login(response: Response, db: Session = Depends(get_db)):
    if not settings.demo_login_enabled:
        raise HTTPException(404, "Demo access is disabled")
    user_id = str(uuid.uuid4())
    user = User(id=user_id, name="SecureShare Demo User", email=f"demo+{user_id}@demo.example.com",
                password_hash=hash_password(secrets.token_urlsafe(32)),
                verified_at=datetime.now(timezone.utc), demo_expires_at=datetime.now(timezone.utc) + timedelta(days=1))
    db.add(user)
    db.flush()
    token = issue_session(user, db, response, lifetime=timedelta(hours=1))
    activity(db, user, "auth.demo", "Started demo session")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "token": token}

# ----------------- Auth Routes -----------------

@app.post("/api/auth/register", status_code=201)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Unable to create account with these details")
    user = User(
        id=str(uuid.uuid4()),
        name=body.name.strip(),
        email=email,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    db.flush()
    raw = issue_one_time(db, user, "verify")
    activity(db, user, "account.created", "Account created; verification pending")
    db.commit()
    try:
        send_email(
            email,
            "Verify your SecureShare email",
            f"Verify your account: {settings.public_app_url}/verify?token={raw}",
        )
    except Exception:
        db.delete(user)
        db.commit()
        raise HTTPException(503, "Verification email could not be sent")
    return {"id": user.id, "name": user.name, "email": user.email, "verification_required": True}

@app.post("/api/auth/verify-email")
def verify_email(body: TokenIn, response: Response, db: Session = Depends(get_db)):
    record = db.get(OneTimeToken, digest(body.token))
    if not record or record.used or record.purpose != "verify" or as_utc(record.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(400, "Verification link is invalid or expired")
    consumed = db.execute(update(OneTimeToken).where(
        OneTimeToken.token_hash == record.token_hash, OneTimeToken.used.is_(False)
    ).values(used=True))
    if consumed.rowcount != 1:
        raise HTTPException(400, "Verification link has already been used")
    user = db.get(User, record.user_id)
    user.verified_at = datetime.now(timezone.utc)
    token = issue_session(user, db, response)
    activity(db, user, "account.verified", "Email verified successfully")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "token": token}

@app.post("/api/auth/resend-verification")
def resend_verification(body: EmailIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user and not user.verified_at:
        raw = issue_one_time(db, user, "verify")
        db.commit()
        send_email(
            user.email,
            "Verify your SecureShare email",
            f"Verify your account: {settings.public_app_url}/verify?token={raw}",
        )
    return {"message": "If the account needs verification, a message has been sent."}

@app.post("/api/auth/forgot-password")
def forgot_password(body: EmailIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user:
        raw = issue_one_time(db, user, "reset")
        db.commit()
        send_email(
            user.email,
            "Reset your SecureShare password",
            f"Reset password: {settings.public_app_url}/reset-password?token={raw}",
        )
    return {"message": "If the account exists, password reset instructions have been sent."}

@app.post("/api/auth/reset-password")
def reset_password(body: TokenIn, db: Session = Depends(get_db)):
    if not body.new_password:
        raise HTTPException(422, "New password is required")
    record = db.get(OneTimeToken, digest(body.token))
    if not record or record.used or record.purpose != "reset" or as_utc(record.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(400, "Reset link is invalid or expired")
    consumed = db.execute(update(OneTimeToken).where(
        OneTimeToken.token_hash == record.token_hash, OneTimeToken.used.is_(False)
    ).values(used=True))
    if consumed.rowcount != 1:
        raise HTTPException(400, "Reset link has already been used")
    user = db.get(User, record.user_id)
    user.password_hash = hash_password(body.new_password)
    # Revoke all sessions
    db.query(SessionRecord).filter(SessionRecord.user_id == user.id).delete(synchronize_session=False)
    db.query(OneTimeToken).filter(OneTimeToken.user_id == user.id, OneTimeToken.used.is_(False)).delete(synchronize_session=False)
    activity(db, user, "security.password_reset", "Password reset successfully; all active sessions revoked")
    db.commit()
    return {"message": "Password updated. Please sign in."}

@app.post("/api/auth/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user or not verify_password(user.password_hash, body.password):
        raise HTTPException(401, "Email or password is incorrect")
    if not user.verified_at:
        raise HTTPException(403, "Verify your email before signing in")
    
    # Check if user has TOTP 2FA enabled
    if user.totp_enabled:
        challenge = issue_one_time(db, user, "2fa_challenge")
        db.commit()
        return {"require_2fa": True, "challenge_token": challenge}

    token = issue_session(user, db, response)
    activity(db, user, "auth.login", "Signed in")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "token": token}

@app.post("/api/auth/login/2fa")
def login_2fa(body: Login2FAIn, response: Response, db: Session = Depends(get_db)):
    record = db.get(OneTimeToken, digest(body.challenge_token))
    if not record or record.used or record.purpose != "2fa_challenge" or as_utc(record.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(400, "2FA challenge token is invalid or expired")
    
    user = db.get(User, record.user_id)
    if not user or not user.totp_enabled:
        raise HTTPException(400, "Two-factor authentication is not configured for this account")

    # Verify either TOTP code or recovery code
    code = body.code.strip()
    is_valid_totp = bool(user.totp_secret and verify_totp_code(reveal_totp_secret(user.totp_secret), code))
    
    if not is_valid_totp and user.recovery_codes_hash:
        try:
            stored_hashes = json.loads(user.recovery_codes_hash)
            matched, remaining = verify_recovery_code(stored_hashes, code)
            if matched:
                is_valid_totp = True
                consumed = db.execute(update(User).where(
                    User.id == user.id, User.recovery_codes_hash == user.recovery_codes_hash
                ).values(recovery_codes_hash=json.dumps(remaining)))
                if consumed.rowcount != 1:
                    raise HTTPException(401, "Recovery code has already been used")
                activity(db, user, "security.recovery_code_used", f"Recovery code consumed. {len(remaining)} remaining.")
                notify(db, user, f"A recovery code was used to access your account. {len(remaining)} codes remaining.")
        except (ValueError, TypeError):
            pass

    if not is_valid_totp:
        raise HTTPException(401, "Invalid authentication code or recovery code")

    consumed = db.execute(update(OneTimeToken).where(
        OneTimeToken.token_hash == record.token_hash, OneTimeToken.used.is_(False)
    ).values(used=True))
    if consumed.rowcount != 1:
        raise HTTPException(400, "2FA challenge has already been used")
    token = issue_session(user, db, response)
    activity(db, user, "auth.login_2fa", "Signed in via two-factor authentication")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "token": token}

# ----------------- 2FA Management Routes -----------------

@app.get("/api/auth/2fa/status")
def two_factor_status(user: User = Depends(current_user)):
    return {"enabled": bool(user.totp_enabled)}

@app.post("/api/auth/2fa/setup")
def setup_two_factor(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.totp_enabled:
        raise HTTPException(409, "Disable two-factor authentication with your password and code before setting it up again")
    secret = generate_totp_secret()
    recovery_codes = generate_recovery_codes()
    hashed_codes = [hash_recovery_code(c) for c in recovery_codes]
    
    user.totp_secret = protect_totp_secret(secret)
    user.recovery_codes_hash = json.dumps(hashed_codes)
    user.totp_enabled = False  # Not enabled until verified
    db.commit()

    otpauth_url = get_provisioning_uri(secret, user.email)
    return {
        "secret": secret,
        "otpauth_url": otpauth_url,
        "recovery_codes": recovery_codes,
    }

@app.post("/api/auth/2fa/enable")
def enable_two_factor(body: TOTPEnableIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not user.totp_secret:
        raise HTTPException(400, "Call /api/auth/2fa/setup before enabling two-factor authentication")
    if not verify_totp_code(reveal_totp_secret(user.totp_secret), body.code.strip()):
        raise HTTPException(400, "Invalid authentication code")
    
    user.totp_enabled = True
    activity(db, user, "security.2fa_enabled", "Two-factor authentication enabled")
    notify(db, user, "Two-factor authentication is now active on your account")
    db.commit()
    return {"enabled": True, "message": "Two-factor authentication successfully enabled"}

@app.post("/api/auth/2fa/disable")
def disable_two_factor(body: TOTPDisableIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(400, "Current password is incorrect")
    
    code = body.code.strip()
    is_valid = bool(user.totp_secret and verify_totp_code(reveal_totp_secret(user.totp_secret), code))
    if not is_valid and user.recovery_codes_hash:
        try:
            stored_hashes = json.loads(user.recovery_codes_hash)
            matched, _ = verify_recovery_code(stored_hashes, code)
            if matched:
                is_valid = True
        except (ValueError, TypeError):
            pass
            
    if not is_valid:
        raise HTTPException(400, "Invalid authentication code or recovery code")

    user.totp_enabled = False
    user.totp_secret = None
    user.recovery_codes_hash = None
    activity(db, user, "security.2fa_disabled", "Two-factor authentication disabled")
    notify(db, user, "Two-factor authentication has been disabled for your account")
    db.commit()
    return {"enabled": False, "message": "Two-factor authentication disabled"}

@app.post("/api/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = session_token(request)
    if raw:
        rec = db.get(SessionRecord, digest(raw))
        if rec:
            db.delete(rec)
            db.commit()
    clear_session_cookie(response)

@app.get("/api/auth/me")
def me(user: User = Depends(current_user)):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "totp_enabled": bool(user.totp_enabled),
    }

@app.post("/api/auth/change-password", status_code=204)
def change_password(body: PasswordChange, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(400, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    raw = session_token(request)
    db.query(SessionRecord).filter(
        SessionRecord.user_id == user.id,
        SessionRecord.token_hash != digest(raw or ""),
    ).delete(synchronize_session=False)
    db.query(OneTimeToken).filter(OneTimeToken.user_id == user.id, OneTimeToken.used.is_(False)).delete(synchronize_session=False)
    activity(db, user, "security.password_changed", "Password changed; other sessions revoked")
    db.commit()

@app.get("/api/auth/sessions")
def sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        {"expires_at": x.expires_at.isoformat()}
        for x in db.scalars(select(SessionRecord).where(SessionRecord.user_id == user.id)).all()
    ]

@app.delete("/api/auth/sessions", status_code=204)
def revoke_sessions(request: Request, response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.query(SessionRecord).filter(SessionRecord.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    clear_session_cookie(response)

# ----------------- Dashboard & Files -----------------

@app.get("/api/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    files = db.scalars(select(FileRecord).where(FileRecord.owner_id == user.id).order_by(FileRecord.created_at.desc())).all()
    ids = [f.id for f in files]
    shares = db.scalars(select(ShareLink).where(ShareLink.file_id.in_(ids))).all() if ids else []
    acts = db.scalars(select(Activity).where(Activity.user_id == user.id).order_by(Activity.created_at.desc()).limit(12)).all()
    return {
        "stats": {
            "files": len(files),
            "shared_files": len({s.file_id for s in shares}),
            "active_links": sum(
                1
                for s in shares
                if not s.revoked
                and (not s.expires_at or as_utc(s.expires_at) > datetime.now(timezone.utc))
                and (not s.max_downloads or s.downloads < s.max_downloads)
            ),
            "downloads": sum(s.downloads for s in shares),
            "storage_bytes": sum(f.size for f in files),
        },
        "files": [safe_file(f) for f in files[:8]],
        "activity": [
            {"action": a.action, "detail": a.detail, "created_at": a.created_at.isoformat()}
            for a in acts
        ],
    }

def start_server_file(db: Session, record: FileRecord) -> None:
    reserve_storage(db, record.owner_id, record.size)
    check_pending_limit(db, record.owner_id)
    record.upload_status = "processing"
    record.upload_expires_at = datetime.now(timezone.utc) + timedelta(seconds=settings.transfer_timeout_seconds + 120)
    db.add(record)
    queue_cleanup(db, record.object_key, not_before=record.upload_expires_at)
    db.commit()


def finish_server_file(db: Session, record: FileRecord, user: User, action: str, request: Request) -> None:
    sequence = next_change_sequence(db, record.owner_id)
    changed = db.execute(update(FileRecord).where(FileRecord.id == record.id,
        FileRecord.upload_status == "processing").values(upload_status="ready", upload_expires_at=None,
            ciphertext_sha256=record.ciphertext_sha256))
    if changed.rowcount != 1:
        raise HTTPException(409, "File processing was cancelled; retry the operation")
    db.refresh(record)
    record_change(db, record, sequence=sequence)
    db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == record.object_key))
    activity(db, user, action, f"{action}: {record.name}")
    record_access_log(db, action=action, file_id=record.id, user_id=user.id,
                      ip_address=request.client.host if request.client else None,
                      user_agent=request.headers.get("user-agent"))
    notify(db, user, f"Encrypted file ready: {record.name}")
    db.commit()


def discard_server_file(db: Session, file_id: str, user: User) -> None:
    db.rollback()
    record = db.scalar(select(FileRecord).where(FileRecord.id == file_id,
                       FileRecord.owner_id == user.id, FileRecord.upload_status == "processing"))
    if record:
        release_storage(db, user.id, record.size)
        queue_file(db, record, storage)
        db.delete(record)
        db.commit()


@app.post("/api/files", status_code=201)
@app.post("/api/files/upload", status_code=201)
async def upload(request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    name = clean_filename(file.filename or "file")
    content = await file.read(settings.max_upload_bytes + 1)
    if not content:
        raise HTTPException(400, "Empty files are not supported")
    if len(content) > settings.max_upload_bytes:
        raise HTTPException(413, "File exceeds the upload limit")

    # Validate file content against declared MIME type & file signature
    is_valid, resolved_type, err_msg = validate_file_content(
        content,
        file.content_type or "application/octet-stream",
        name,
    )
    if not is_valid:
        raise HTTPException(400, err_msg)

    checksum = hashlib.sha256(content).hexdigest()
    ciphertext, nonce, wrapped = await run_in_threadpool(encrypt_file, content)
    object_key = secrets.token_hex(32)
    record = FileRecord(
        id=str(uuid.uuid4()),
        owner_id=user.id,
        name=name,
        content_type=resolved_type[:120],
        size=len(content),
        object_key=object_key,
        nonce=nonce,
        wrapped_key=wrapped,
        sha256_checksum=checksum,
        ciphertext_sha256=hashlib.sha256(ciphertext).hexdigest(),
        ciphertext_size=len(ciphertext),
        client_modified_at=datetime.now(timezone.utc),
    )
    start_server_file(db, record)
    try:
        await run_in_threadpool(storage.put, object_key, ciphertext)
        finish_server_file(db, record, user, "file.uploaded", request)
    except HTTPException:
        discard_server_file(db, record.id, user)
        raise
    except Exception:
        discard_server_file(db, record.id, user)
        raise HTTPException(503, "Storage is temporarily unavailable; retry the upload")
    return safe_file(record)

# ----------------- Resumable legacy (v1) uploads -----------------

def resumable_record(upload_id: str, user: User, db: Session) -> ResumableUpload:
    record = db.scalar(select(ResumableUpload).where(ResumableUpload.id == upload_id, ResumableUpload.user_id == user.id))
    if not record:
        raise HTTPException(404, "Resumable upload session not found")
    if as_utc(record.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(410, "Resumable upload expired")
    return record


def claim_resumable(db: Session, record: ResumableUpload, state: str) -> str:
    now = datetime.now(timezone.utc)
    token = secrets.token_hex(16)
    result = db.execute(update(ResumableUpload).where(
        ResumableUpload.id == record.id, ResumableUpload.expires_at > now,
        or_(ResumableUpload.state == "pending", ResumableUpload.lease_expires_at <= now),
    ).values(state=state, transfer_token=token,
             lease_expires_at=now + timedelta(seconds=settings.transfer_timeout_seconds + 120))
             .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Another chunk or completion is in progress; retry shortly")
    db.commit()
    db.refresh(record)
    return token


def reset_resumable(db: Session, upload_id: str, token: str) -> None:
    db.rollback()
    db.execute(update(ResumableUpload).where(ResumableUpload.id == upload_id,
        ResumableUpload.transfer_token == token).values(state="pending", transfer_token=None, lease_expires_at=None))
    db.commit()

@app.post("/api/files/resumable/init", status_code=201)
def init_resumable_upload(body: ResumableInitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.size > settings.max_upload_bytes:
        raise HTTPException(413, f"Total size exceeds upload limit of {settings.max_upload_bytes} bytes")
    if body.total_chunks > body.size or body.total_chunks * settings.max_chunk_bytes < body.size:
        raise HTTPException(422, "Chunk count must accommodate the total size with nonempty, bounded chunks")
    reserve_storage(db, user.id, body.size)
    check_pending_limit(db, user.id)
    upload_id = str(uuid.uuid4())
    upload_record = ResumableUpload(
        id=upload_id,
        user_id=user.id,
        name=clean_filename(body.name),
        content_type=body.content_type[:120],
        total_size=body.size,
        total_chunks=body.total_chunks,
        completed_chunks="[]",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(upload_record)
    db.commit()
    return {
        "upload_id": upload_id,
        "name": upload_record.name,
        "total_chunks": upload_record.total_chunks,
        "total_size": upload_record.total_size,
        "max_chunk_bytes": settings.max_chunk_bytes,
        "expires_at": upload_record.expires_at.isoformat(),
        "encryption_version": "v1",
    }

@app.put("/api/files/resumable/{upload_id}/chunk/{chunk_index}")
async def upload_chunk(
    upload_id: str,
    chunk_index: int,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    upload_rec = resumable_record(upload_id, user, db)
    if chunk_index < 0 or chunk_index >= upload_rec.total_chunks:
        raise HTTPException(400, f"Invalid chunk index {chunk_index} for total chunks {upload_rec.total_chunks}")
    
    token = claim_resumable(db, upload_rec, "receiving")
    key = chunk_key(upload_rec.id, chunk_index)
    queue_cleanup(db, key, not_before=as_utc(upload_rec.lease_expires_at))
    db.commit()  # Crash-safe cleanup exists before any object is written.
    try:
        data = bytearray()
        maximum = min(settings.max_chunk_bytes, upload_rec.total_size)
        with anyio.fail_after(settings.transfer_timeout_seconds):
            async for chunk in request.stream():
                if len(data) + len(chunk) > maximum:
                    raise HTTPException(413, "Chunk exceeds the authorized chunk size")
                data.extend(chunk)
        if not data:
            raise HTTPException(400, "Empty chunk data")
        existing = db.get(UploadChunk, (upload_rec.id, chunk_index))
        if existing:
            cipher = await run_in_threadpool(storage.read_bounded, key, existing.size + 16)
            previous = await run_in_threadpool(decrypt_file, cipher, existing.nonce, existing.wrapped_key)
            if previous != bytes(data):
                raise HTTPException(409, "Uploaded chunks are immutable; restart the upload to change a chunk")
            reset_resumable(db, upload_id, token)
            return {"upload_id": upload_id, "chunk_index": chunk_index, "received_bytes": len(data)}
        if upload_rec.received_bytes + len(data) > upload_rec.total_size:
            raise HTTPException(413, "Chunks exceed the reserved total size")
        ciphertext, nonce, wrapped = await run_in_threadpool(encrypt_file, bytes(data))
        await run_in_threadpool(storage.put, key, ciphertext)
        changed = db.execute(update(ResumableUpload).where(
            ResumableUpload.id == upload_id, ResumableUpload.transfer_token == token,
            ResumableUpload.state == "receiving", ResumableUpload.expires_at > datetime.now(timezone.utc),
        ).values(state="pending", transfer_token=None, lease_expires_at=None,
                 received_bytes=ResumableUpload.received_bytes + len(data)).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            raise HTTPException(409, "Upload was cancelled or expired during transfer")
        db.add(UploadChunk(upload_id=upload_rec.id, chunk_index=chunk_index, size=len(data), nonce=nonce, wrapped_key=wrapped))
        db.flush()
        upload_rec.completed_chunks = json.dumps(list(db.scalars(select(UploadChunk.chunk_index)
            .where(UploadChunk.upload_id == upload_id).order_by(UploadChunk.chunk_index))))
        db.commit()
    except HTTPException:
        reset_resumable(db, upload_id, token)
        raise
    except TimeoutError:
        reset_resumable(db, upload_id, token)
        raise HTTPException(408, "Chunk transfer timed out; retry this chunk")
    except Exception:
        reset_resumable(db, upload_id, token)
        raise HTTPException(503, "Encrypted chunk storage is unavailable; retry this chunk")
    except BaseException:
        reset_resumable(db, upload_id, token)
        raise
    return {"upload_id": upload_id, "chunk_index": chunk_index, "received_bytes": len(data)}

@app.get("/api/files/resumable/{upload_id}/status")
def resumable_status(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    upload_rec = resumable_record(upload_id, user, db)
    completed = list(db.scalars(select(UploadChunk.chunk_index).where(UploadChunk.upload_id == upload_id)
                               .order_by(UploadChunk.chunk_index)))
    return {
        "upload_id": upload_id,
        "total_chunks": upload_rec.total_chunks,
        "completed_chunks": completed,
        "complete": len(completed) == upload_rec.total_chunks,
        "received_bytes": upload_rec.received_bytes,
        "state": upload_rec.state,
        "expires_at": upload_rec.expires_at.isoformat(),
    }

@app.post("/api/files/resumable/{upload_id}/complete", status_code=201)
def complete_resumable_upload(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    existing = db.scalar(select(FileRecord).where(FileRecord.id == upload_id, FileRecord.owner_id == user.id))
    if existing:
        return safe_file(existing)
    upload_rec = resumable_record(upload_id, user, db)
    token = claim_resumable(db, upload_rec, "completing")
    try:
        chunks = list(db.scalars(select(UploadChunk).where(UploadChunk.upload_id == upload_id).order_by(UploadChunk.chunk_index)))
        if len(chunks) != upload_rec.total_chunks or sum(c.size for c in chunks) != upload_rec.total_size:
            raise HTTPException(400, "Upload every chunk with the exact reserved total size before completing")
        if upload_rec.total_size > settings.max_upload_bytes:
            raise HTTPException(413, "Total size exceeds the upload limit")
        assembled = bytearray()
        for index, chunk in enumerate(chunks):
            if chunk.chunk_index != index:
                raise HTTPException(400, "A chunk is missing")
            cipher = storage.read_bounded(chunk_key(upload_id, index), chunk.size + 16)
            plain = decrypt_file(cipher, chunk.nonce, chunk.wrapped_key)
            if len(plain) != chunk.size:
                raise HTTPException(422, "Encrypted chunk integrity check failed")
            assembled.extend(plain)
        full_content = bytes(assembled)
        del assembled
        valid, resolved_type, error = validate_file_content(full_content, upload_rec.content_type, upload_rec.name)
        if not valid:
            raise HTTPException(400, error)
        ciphertext, nonce, wrapped = encrypt_file(full_content)
        object_key = secrets.token_hex(32)
        queue_cleanup(db, object_key, not_before=as_utc(upload_rec.lease_expires_at))
        db.commit()
        storage.put(object_key, ciphertext)
        sequence = next_change_sequence(db, user.id)
        claimed = db.execute(update(ResumableUpload).where(ResumableUpload.id == upload_id,
            ResumableUpload.transfer_token == token, ResumableUpload.state == "completing",
            ResumableUpload.expires_at > datetime.now(timezone.utc)).values(state="complete").execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            raise HTTPException(409, "Upload changed or expired during completion")
        record = FileRecord(
            id=upload_id, owner_id=user.id, name=upload_rec.name, content_type=resolved_type[:120],
            size=len(full_content), object_key=object_key, nonce=nonce, wrapped_key=wrapped,
            sha256_checksum=hashlib.sha256(full_content).hexdigest(),
            ciphertext_sha256=hashlib.sha256(ciphertext).hexdigest(), ciphertext_size=len(ciphertext),
            client_modified_at=datetime.now(timezone.utc),
        )
        db.add(record)
        record_change(db, record, sequence=sequence)
        queue_chunks(db, upload_rec)
        db.delete(upload_rec)  # Its reservation is transferred to the file, not released twice.
        db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == object_key))
        activity(db, user, "file.uploaded_resumable", f"Resumable upload complete: {record.name}")
        record_access_log(db, action="file.uploaded_resumable", file_id=record.id, user_id=user.id)
        notify(db, user, f"Encrypted resumable upload complete: {record.name}")
        db.commit()
    except HTTPException:
        reset_resumable(db, upload_id, token)
        raise
    except Exception:
        reset_resumable(db, upload_id, token)
        raise HTTPException(503, "Encrypted chunks or storage are unavailable; retry or restart the upload")
    drain_cleanup(db, storage)
    return safe_file(record)

@app.delete("/api/files/resumable/{upload_id}", status_code=204)
def abort_resumable_upload(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    upload_rec = db.scalar(select(ResumableUpload).where(ResumableUpload.id == upload_id, ResumableUpload.user_id == user.id))
    if not upload_rec:
        raise HTTPException(404, "Resumable upload session not found")
    if upload_rec.lease_expires_at and as_utc(upload_rec.lease_expires_at) > datetime.now(timezone.utc):
        raise HTTPException(409, "A transfer is active; retry cancellation after it stops")
    release_storage(db, user.id, upload_rec.total_size)
    queue_chunks(db, upload_rec)
    db.delete(upload_rec)
    db.commit()
    drain_cleanup(db, storage)

# ----------------- File Operations -----------------

@app.get("/api/files")
def list_files(limit: int = 100, offset: int = 0, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not 1 <= limit <= 500 or offset < 0:
        raise HTTPException(422, "Limit must be 1–500 and offset cannot be negative")
    return [
        safe_file(f)
        for f in db.scalars(
            select(FileRecord)
            .where(FileRecord.owner_id == user.id, FileRecord.is_deleted.is_(False), FileRecord.upload_status == "ready")
            .order_by(FileRecord.created_at.desc(), FileRecord.id.desc()).limit(limit).offset(offset)
        ).all()
    ]

@app.get("/api/files/trash")
def list_trash(limit: int = 500, offset: int = 0, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """List soft-deleted files in trash."""
    if not 1 <= limit <= 500 or offset < 0:
        raise HTTPException(422, "Limit must be 1–500 and offset cannot be negative")
    files = db.scalars(
        select(FileRecord)
        .where(FileRecord.owner_id == user.id, FileRecord.is_deleted.is_(True), FileRecord.upload_status == "ready")
        .order_by(FileRecord.deleted_at.desc(), FileRecord.id.desc()).limit(limit).offset(offset)
    ).all()
    return [safe_file(f) for f in files]

@app.get("/api/files/shared-with-me")
def shared_with_me(limit: int = 100, offset: int = 0, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not 1 <= limit <= 500 or offset < 0:
        raise HTTPException(422, "Limit must be 1–500 and offset cannot be negative")
    rows = db.execute(select(FileRecord, FilePermission.role, User.name)
        .join(FilePermission, FilePermission.file_id == FileRecord.id)
        .join(User, User.id == FileRecord.owner_id)
        .where(or_(FilePermission.user_id == user.id, FilePermission.email == user.email),
               FileRecord.owner_id != user.id, FileRecord.is_deleted.is_(False), FileRecord.upload_status == "ready")
        .order_by(FileRecord.created_at.desc(), FileRecord.id).limit(limit).offset(offset)).all()
    return [{**safe_file(file), "access_role": role, "owner_name": owner} for file, role, owner in rows]

@app.get("/api/files/pending")
def pending_files(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [{"id": file.id, "name": file.name, "size": file.size, "status": file.upload_status,
             "expires_at": file.upload_expires_at.isoformat() if file.upload_expires_at else None}
            for file in db.scalars(select(FileRecord).where(FileRecord.owner_id == user.id,
                FileRecord.upload_status != "ready").order_by(FileRecord.created_at).limit(settings.max_pending_uploads))]

@app.get("/api/files/{file_id}")
def file_detail(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = readable_file(file_id, user, db)
    role = "OWNER" if f.owner_id == user.id else db.scalar(select(FilePermission.role).where(
        FilePermission.file_id == f.id, or_(FilePermission.user_id == user.id, FilePermission.email == user.email)
    ))
    return {**safe_file(f), "access_role": role}

@app.get("/api/files/{file_id}/download")
@app.post("/api/files/{file_id}/download")
def download(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    try:
        f = readable_file(file_id, user, db)
    except HTTPException:
        record_access_log(
            db,
            action="file.download_denied",
            file_id=file_id,
            user_id=user.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="denied",
            failure_reason="File not found or permission denied",
        )
        db.commit()
        raise HTTPException(404, "File not found")
    if f.encryption_version != "v1":
        raise HTTPException(409, "This file must be downloaded and decrypted on your device using a download intent")

    try:
        plain = decrypt_file(storage.read_bounded(f.object_key, f.size + 16), f.nonce, f.wrapped_key)
        if getattr(f, "sha256_checksum", None):
            calc_sum = hashlib.sha256(plain).hexdigest()
            if calc_sum != f.sha256_checksum:
                raise ValueError("Checksum verification failed")
    except Exception:
        record_access_log(
            db,
            action="file.download_failed",
            file_id=f.id,
            user_id=user.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="failure",
            failure_reason="Integrity or decryption check failed",
        )
        db.commit()
        raise HTTPException(500, "File integrity check failed")

    activity(db, user, "file.downloaded", f"Downloaded {f.name}")
    record_access_log(
        db,
        action="file.downloaded",
        file_id=f.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()

    headers = {
        "Content-Disposition": content_disposition(f.name),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if getattr(f, "sha256_checksum", None):
        headers["Digest"] = "sha-256=" + base64.b64encode(bytes.fromhex(f.sha256_checksum)).decode()
        headers["X-Checksum-SHA256"] = f.sha256_checksum

    return StreamingResponse(
        iter([plain]),
        media_type=f.content_type or "application/octet-stream",
        headers=headers,
    )

@app.delete("/api/files/{file_id}", status_code=204)
def delete_file(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db, include_pending=True, include_trash=True)
    if f.upload_status == "receiving" and f.lease_expires_at and as_utc(f.lease_expires_at) > datetime.now(timezone.utc):
        raise HTTPException(409, "Cancel the active transfer before deleting its upload")
    release_storage(db, user.id, f.size)
    changed = db.execute(update(FileRecord).where(FileRecord.id == f.id,
        FileRecord.owner_id == user.id, FileRecord.version == f.version,
        FileRecord.upload_status == f.upload_status).values(version=FileRecord.version + 1))
    if changed.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "File changed while deleting; refresh and retry")
    db.refresh(f)
    if f.upload_status == "ready":
        f.client_modified_at = datetime.now(timezone.utc)
        record_change(db, f, removed=True)
    queue_file(db, f, storage)
    db.delete(f)
    activity(db, user, "file.deleted", f"Deleted {f.name}")
    record_access_log(
        db,
        action="file.deleted",
        file_id=file_id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
        owner_id=user.id,
    )
    db.commit()
    drain_cleanup(db, storage)

# ----------------- Share Links -----------------

@app.post("/api/files/{file_id}/shares", status_code=201)
@app.post("/api/files/{file_id}/share", status_code=201)
def create_share(file_id: str, body: ShareIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db)
    token = secrets.token_urlsafe(32)
    expiry = datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours) if body.expires_in_hours else None
    sh = ShareLink(
        id=str(uuid.uuid4()),
        file_id=f.id,
        token_hash=digest(token),
        expires_at=expiry,
        max_downloads=body.max_downloads,
        password_hash=hash_password(body.password) if body.password else None,
    )
    db.add(sh)
    activity(db, user, "share.created", f"Created a share link for {f.name}")
    record_access_log(
        db,
        action="share.created",
        file_id=f.id,
        share_id=sh.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    notify(db, user, f"Sharing link created for {f.name}")
    db.commit()
    return {
        "id": sh.id,
        "url": f"{settings.public_app_url.rstrip('/')}/share/{token}",
        "expires_at": expiry.isoformat() if expiry else None,
        "max_downloads": body.max_downloads,
    }

@app.get("/api/shares")
def list_shares(user: User = Depends(current_user), db: Session = Depends(get_db)):
    files = db.scalars(select(FileRecord).where(FileRecord.owner_id == user.id)).all()
    names = {f.id: f.name for f in files}
    shares = db.scalars(select(ShareLink).where(ShareLink.file_id.in_(names.keys()))).all() if names else []
    return [
        {
            "id": s.id,
            "file_id": s.file_id,
            "file_name": names[s.file_id],
            "expires_at": s.expires_at.isoformat() if s.expires_at else None,
            "max_downloads": s.max_downloads,
            "downloads": s.downloads,
            "revoked": s.revoked,
            "password_required": bool(s.password_hash),
            "created_at": s.created_at.isoformat(),
        }
        for s in shares
    ]

@app.get("/api/shares/manage/{share_id}")
def get_share_detail_explicit(share_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    if not s:
        raise HTTPException(404, "Share not found")
    f = db.get(FileRecord, s.file_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Share not found")
    return {
        "id": s.id,
        "file_id": s.file_id,
        "file_name": f.name,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "max_downloads": s.max_downloads,
        "downloads": s.downloads,
        "revoked": s.revoked,
        "password_required": bool(s.password_hash),
        "created_at": s.created_at.isoformat(),
    }

@app.patch("/api/shares/{share_id}")
def update_share(share_id: str, body: ShareUpdateIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    if not s:
        raise HTTPException(404, "Share not found")
    f = db.get(FileRecord, s.file_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Share not found")

    if body.expires_in_hours is not None:
        s.expires_at = datetime.now(timezone.utc) + timedelta(hours=body.expires_in_hours)
    if body.max_downloads is not None:
        s.max_downloads = body.max_downloads
    if body.password is not None:
        s.password_hash = hash_password(body.password) if body.password else None
        db.query(ShareGrant).filter(ShareGrant.share_id == s.id).delete(synchronize_session=False)
        db.query(StorageGrant).filter(StorageGrant.share_id == s.id).delete(synchronize_session=False)
    if body.revoked is not None:
        s.revoked = body.revoked
        if s.revoked:
            for grant in db.scalars(select(ShareGrant).where(ShareGrant.share_id == s.id)).all():
                db.delete(grant)
            db.query(StorageGrant).filter(StorageGrant.share_id == s.id).delete(synchronize_session=False)

    activity(db, user, "share.updated", f"Updated sharing link settings for {f.name}")
    record_access_log(
        db,
        action="share.updated",
        file_id=f.id,
        share_id=s.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()
    return {
        "id": s.id,
        "file_id": s.file_id,
        "file_name": f.name,
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "max_downloads": s.max_downloads,
        "downloads": s.downloads,
        "revoked": s.revoked,
        "password_required": bool(s.password_hash),
    }

# ----------------- Public Sharing Routes -----------------

@app.get("/api/public/shares/{token}")
@app.get("/api/shares/{token}")
def inspect_share(token: str, request: Request, db: Session = Depends(get_db)):
    s = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token)))
    if not s:
        # Check if caller is owner asking for share details by share_id
        cookie = request.cookies.get(COOKIE)
        if cookie:
            sess = db.scalar(select(SessionRecord).where(SessionRecord.token_hash == digest(cookie), SessionRecord.expires_at > datetime.now(timezone.utc)))
            if sess:
                share_by_id = db.get(ShareLink, token)
                if share_by_id:
                    f_owner = db.get(FileRecord, share_by_id.file_id)
                    if f_owner and f_owner.owner_id == sess.user_id:
                        return {
                            "id": share_by_id.id,
                            "file_id": share_by_id.file_id,
                            "file_name": f_owner.name,
                            "expires_at": share_by_id.expires_at.isoformat() if share_by_id.expires_at else None,
                            "max_downloads": share_by_id.max_downloads,
                            "downloads": share_by_id.downloads,
                            "revoked": share_by_id.revoked,
                            "password_required": bool(share_by_id.password_hash),
                            "created_at": share_by_id.created_at.isoformat(),
                        }
        record_access_log(
            db,
            action="share.inspect_failed",
            share_id=None,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="denied",
            failure_reason="Share link not found",
        )
        db.commit()
        raise HTTPException(404, "Share link is unavailable")

    if s.revoked or (s.expires_at and as_utc(s.expires_at) <= datetime.now(timezone.utc)) or (s.max_downloads and s.downloads >= s.max_downloads):
        record_access_log(
            db,
            action="share.inspect_failed",
            share_id=s.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="denied",
            failure_reason="Link expired, revoked, or download limit reached",
        )
        db.commit()
        raise HTTPException(404, "Share link is unavailable")

    f = db.get(FileRecord, s.file_id)
    if not f or f.is_deleted or f.upload_status != "ready":
        raise HTTPException(404, "File not found")

    record_access_log(
        db,
        action="share.inspected",
        file_id=f.id,
        share_id=s.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()

    return {
        "name": f.name,
        "encryption_version": f.encryption_version,
        "size": f.size,
        "content_type": f.content_type,
        "sha256_checksum": getattr(f, "sha256_checksum", None),
        "expires_at": s.expires_at.isoformat() if s.expires_at else None,
        "max_downloads": s.max_downloads,
        "downloads": s.downloads,
        "password_required": bool(s.password_hash),
    }

@app.post("/api/shares/{token}/verify")
@app.post("/api/public/shares/{token}/verify")
def verify_share(token: str, body: ShareVerify, request: Request, db: Session = Depends(get_db)):
    s = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token)))
    if not valid_share(s):
        raise HTTPException(404, "Share link is unavailable")
    if not s.password_hash or not verify_password(s.password_hash, body.password):
        record_access_log(
            db,
            action="share.verify_failed",
            share_id=s.id,
            file_id=s.file_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="failure",
            failure_reason="Incorrect password",
        )
        db.commit()
        raise HTTPException(403, "Share password is incorrect")

    grant = secrets.token_urlsafe(32)
    db.add(
        ShareGrant(
            token_hash=digest(grant),
            share_id=s.id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        )
    )
    record_access_log(
        db,
        action="share.verify_success",
        share_id=s.id,
        file_id=s.file_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()
    return {"verified": True, "grant": grant}

@app.post("/api/shares/{token}/download")
@app.post("/api/public/shares/{token}/download")
def shared_download(token: str, request: Request, db: Session = Depends(get_db)):
    try:
        share, file = authorized_share(token, request, db)
    except HTTPException as error:
        record_access_log(db, action="share.download_denied", result="denied", failure_reason=str(error.detail)[:100],
                          ip_address=request.client.host if request.client else None,
                          user_agent=request.headers.get("user-agent"))
        db.commit()
        raise
    if file.encryption_version != "v1":
        raise HTTPException(409, "Use a download intent to decrypt this device-encrypted file locally")
    try:
        plain = decrypt_file(storage.read_bounded(file.object_key, file.size + 16), file.nonce, file.wrapped_key)
        if file.sha256_checksum and hashlib.sha256(plain).hexdigest() != file.sha256_checksum:
            raise ValueError("Checksum verification failed")
    except Exception:
        record_access_log(db, action="share.download_failed", share_id=share.id, file_id=file.id,
                          result="failure", failure_reason="Integrity or decryption check failed")
        db.commit()
        raise HTTPException(500, "File integrity check failed")
    # Validate payload before reserving a download, and keep the counter's
    # conditional database update short. Unrelated files transfer concurrently.
    consume_shared_transfer(db, share)
    owner = db.get(User, file.owner_id)
    activity(db, owner, "share.downloaded", f"A recipient downloaded {file.name}")
    notify(db, owner, f"A shared file was downloaded: {file.name}")
    record_access_log(db, action="share.downloaded", share_id=share.id, file_id=file.id,
                      ip_address=request.client.host if request.client else None,
                      user_agent=request.headers.get("user-agent"))
    db.commit()
    headers = {"Content-Disposition": content_disposition(file.name), "Cache-Control": "no-store",
               "X-Content-Type-Options": "nosniff"}
    if file.sha256_checksum:
        headers["Digest"] = "sha-256=" + base64.b64encode(bytes.fromhex(file.sha256_checksum)).decode()
        headers["X-Checksum-SHA256"] = file.sha256_checksum
    return StreamingResponse(iter([plain]), media_type=file.content_type, headers=headers)

@app.delete("/api/shares/{share_id}", status_code=204)
def revoke_share(share_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    f = db.get(FileRecord, s.file_id) if s else None
    if not s or not f or f.owner_id != user.id:
        raise HTTPException(404, "Share not found")
    s.revoked = True
    for grant in db.scalars(select(ShareGrant).where(ShareGrant.share_id == s.id)).all():
        db.delete(grant)
    db.query(StorageGrant).filter(StorageGrant.share_id == s.id).delete(synchronize_session=False)
    activity(db, f.owner, "share.revoked", f"Revoked sharing for {f.name}")
    record_access_log(
        db,
        action="share.revoked",
        file_id=f.id,
        share_id=s.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()

# ----------------- Permissions -----------------

@app.get("/api/files/{file_id}/permissions")
def list_permissions(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db)
    perms = db.scalars(select(FilePermission).where(FilePermission.file_id == f.id).order_by(FilePermission.created_at.desc())).all()
    return [
        {
            "id": p.id,
            "file_id": p.file_id,
            "email": p.email,
            "role": p.role,
            "created_at": p.created_at.isoformat(),
        }
        for p in perms
    ]

@app.post("/api/files/{file_id}/permissions", status_code=201)
def add_permission(file_id: str, body: PermissionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db)
    reserve_storage(db, user.id, 0)  # Serialize grants for this owner to avoid duplicate permission rows.
    email = body.email.lower().strip()
    if email == user.email.lower():
        raise HTTPException(400, "Owner already has full permissions")

    target_user = db.scalar(select(User).where(User.email == email))
    existing = db.scalar(select(FilePermission).where(FilePermission.file_id == f.id, FilePermission.email == email))
    if existing:
        existing.role = body.role
        perm = existing
    else:
        perm = FilePermission(
            id=str(uuid.uuid4()),
            file_id=f.id,
            user_id=target_user.id if target_user else None,
            granted_by=user.id,
            email=email,
            role=body.role,
        )
        db.add(perm)

    activity(db, user, "permission.granted", f"Granted {body.role} access on {f.name} to {email}")
    if target_user:
        notify(db, target_user, f"{user.name} granted you {body.role} access to {f.name}")
    db.commit()
    return {
        "id": perm.id,
        "file_id": perm.file_id,
        "email": perm.email,
        "role": perm.role,
        "created_at": perm.created_at.isoformat(),
    }

@app.patch("/api/permissions/{permission_id}")
def update_permission(permission_id: str, body: PermissionUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    perm = db.get(FilePermission, permission_id)
    if not perm:
        raise HTTPException(404, "Permission not found")
    f = db.get(FileRecord, perm.file_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(403, "Not authorized to modify permissions for this file")

    perm.role = body.role
    activity(db, user, "permission.updated", f"Updated permission for {perm.email} on {f.name} to {body.role}")
    db.commit()
    return {"id": perm.id, "role": perm.role}

@app.delete("/api/permissions/{permission_id}", status_code=204)
def delete_permission(permission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    perm = db.get(FilePermission, permission_id)
    if not perm:
        raise HTTPException(404, "Permission not found")
    f = db.get(FileRecord, perm.file_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(403, "Not authorized to delete permissions for this file")

    db.delete(perm)
    activity(db, user, "permission.revoked", f"Revoked access on {f.name} for {perm.email}")
    db.commit()

# ----------------- Access Logs -----------------

@app.get("/api/files/{file_id}/access-logs")
def file_access_logs(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.scalar(select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id))
    logs = db.scalars(
        select(FileAccessLog)
        .where(FileAccessLog.owner_id == user.id, FileAccessLog.subject_file_id == file_id)
        .order_by(FileAccessLog.created_at.desc())
        .limit(50)
    ).all()
    if not f and not logs:
        raise HTTPException(404, "File history not found")
    if logs:
        return [
            {
                "id": l.id,
                "action": l.action,
                "detail": f"{l.action} ({l.result})",
                "result": l.result,
                "failure_reason": l.failure_reason,
                "ip_address": l.ip_address,
                "user_agent": l.user_agent,
                "created_at": l.created_at.isoformat(),
            }
            for l in logs
        ]
    # Fallback to activities for backwards compatibility
    return [
        {"action": a.action, "detail": a.detail, "result": "success", "created_at": a.created_at.isoformat()}
        for a in db.scalars(
            select(Activity).where(Activity.user_id == user.id, Activity.detail.contains(f.name)).order_by(Activity.created_at.desc()).limit(50)
        ).all()
    ]

@app.get("/api/shares/{share_id}/access-logs")
def share_access_logs(share_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    f = db.get(FileRecord, s.file_id) if s else None
    if f and f.owner_id != user.id:
        raise HTTPException(404, "Share not found")

    logs = db.scalars(
        select(FileAccessLog)
        .where(FileAccessLog.owner_id == user.id, FileAccessLog.subject_share_id == share_id)
        .order_by(FileAccessLog.created_at.desc())
        .limit(50)
    ).all()
    if not f and not logs:
        raise HTTPException(404, "Share history not found")
    return [
        {
            "id": l.id,
            "action": l.action,
            "result": l.result,
            "failure_reason": l.failure_reason,
            "ip_address": l.ip_address,
            "user_agent": l.user_agent,
            "created_at": l.created_at.isoformat(),
        }
        for l in logs
    ]

@app.get("/api/access-logs")
def global_access_logs(user: User = Depends(current_user), db: Session = Depends(get_db)):
    logs = db.scalars(
        select(FileAccessLog)
        .where(
            or_(
                FileAccessLog.user_id == user.id,
                FileAccessLog.owner_id == user.id,
            )
        )
        .order_by(FileAccessLog.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": l.id,
            "file_id": l.subject_file_id or l.file_id,
            "share_id": l.subject_share_id or l.share_id,
            "action": l.action,
            "result": l.result,
            "failure_reason": l.failure_reason,
            "ip_address": l.ip_address,
            "user_agent": l.user_agent,
            "created_at": l.created_at.isoformat(),
        }
        for l in logs
    ]

# ----------------- Encryption Metadata -----------------

@app.get("/api/files/{file_id}/encryption/metadata")
def get_encryption_metadata(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = readable_file(file_id, user, db)
    return {
        "file_id": f.id,
        "name": f.name,
        "algorithm": "AES-256-GCM",
        "cipher_mode": "Authenticated Encryption with Associated Data (AEAD)",
        "key_length_bits": 256,
        "nonce_length_bytes": len(f.nonce),
        "nonce_hex": f.nonce.hex(),
        "wrapped_key_size_bytes": len(f.wrapped_key),
        "sha256_checksum": getattr(f, "sha256_checksum", None),
        "file_size_bytes": f.size,
        "key_wrapping_scheme": "Client-held key; no server decryption key" if f.encryption_version == "v2" else "Envelope Encryption (AES-256-GCM under KEK)",
        "encryption_version": f.encryption_version,
        "ciphertext_sha256": f.ciphertext_sha256,
        "verification_location": "device" if f.encryption_version == "v2" else "server",
        "authenticated_tag_bits": 128,
        "tamper_verification": "Not checked by this metadata request",
        "created_at": f.created_at.isoformat(),
    }

@app.post("/api/files/{file_id}/encryption/metadata")
def verify_encryption_metadata(file_id: str, body: EncryptionMetadataVerifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = readable_file(file_id, user, db)
    try:
        if f.encryption_version == "v2":
            size, checksum = storage.fingerprint(f.object_key)
            valid = size == f.ciphertext_size and checksum == f.ciphertext_sha256
            return {"file_id": f.id, "valid": valid, "ciphertext_verified": valid,
                    "checksum_verified": False, "requires_client_verification": True,
                    "calculated_ciphertext_sha256": checksum, "algorithm": "AES-256-GCM"}
        raw_ciphertext = storage.read_bounded(f.object_key, f.size + 16)
        plain = decrypt_file(raw_ciphertext, f.nonce, f.wrapped_key)
        calc_sum = hashlib.sha256(plain).hexdigest()
        is_verified = (calc_sum == f.sha256_checksum) if f.sha256_checksum else True
        if body.sha256_checksum and body.sha256_checksum != calc_sum:
            is_verified = False
        return {
            "file_id": f.id,
            "valid": is_verified,
            "checksum_verified": is_verified,
            "calculated_sha256": calc_sum,
            "algorithm": "AES-256-GCM",
        }
    except Exception:
        return {
            "file_id": f.id,
            "valid": False,
            "checksum_verified": False,
            "error": "Decryption failed or ciphertext was modified",
        }

# ----------------- Storage & Notifications -----------------

@app.get("/api/storage/usage")
def storage_usage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    total = db.scalar(select(User.storage_reserved_bytes).where(User.id == user.id))
    ready = db.scalar(select(func.coalesce(func.sum(FileRecord.size), 0)).where(
        FileRecord.owner_id == user.id, FileRecord.upload_status == "ready"))
    trash = db.scalar(select(func.coalesce(func.sum(FileRecord.size), 0)).where(
        FileRecord.owner_id == user.id, FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(True)))
    return {"bytes": total, "limit": settings.account_quota_bytes, "active_bytes": ready - trash,
            "trash_bytes": trash, "pending_bytes": max(0, total - ready), "max_file_bytes": settings.max_upload_bytes}

@app.get("/api/notifications")
def notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        {"id": n.id, "message": n.message, "read": n.read, "created_at": n.created_at.isoformat()}
        for n in db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())).all()
    ]

@app.patch("/api/notifications/{notification_id}")
def read_notification(notification_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id))
    if not n:
        raise HTTPException(404, "Notification not found")
    n.read = True
    db.commit()
    return {"id": n.id, "read": True}

@app.post("/api/notifications/mark-all-read")
def mark_all_notifications_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read.is_(False))
        .values(read=True)
    )
    db.commit()
    return {"status": "ok"}

# ==============================================================================
# PHASE 4 & 5: DEVICE-POWERED FILE PROCESSING & LOCAL-FIRST CLOUD SYNCHRONIZATION
# ==============================================================================

@app.post("/api/storage/upload-intent", status_code=201)
def upload_intent(body: UploadIntentIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Authorize direct encrypted upload from device to object storage.
    Render coordinates metadata and generates short-lived upload authorization.
    Render does NOT receive or process plaintext file contents.
    """
    if body.size > settings.max_upload_bytes:
        raise HTTPException(413, f"File exceeds maximum size limit of {settings.max_upload_bytes} bytes")

    if body.ciphertext_size != body.size + 16:
        raise HTTPException(422, "AES-GCM ciphertext must contain the plaintext bytes plus a 16-byte authentication tag")
    clean_name = clean_filename(body.name)
    try:
        nonce_bytes = base64.b64decode(body.nonce_b64, validate=True)
    except ValueError:
        raise HTTPException(400, "Invalid base64 nonce")
    if len(nonce_bytes) != 12:
        raise HTTPException(422, "AES-GCM nonce must be exactly 12 bytes")
    if body.device_id:
        device = db.get(DeviceRecord, body.device_id)
        if not device or device.user_id != user.id or device.revoked:
            raise HTTPException(403, "Register an active device before uploading")

    object_key = secrets.token_hex(32)
    file_id = str(uuid.uuid4())

    record = FileRecord(
        id=file_id,
        owner_id=user.id,
        name=clean_name,
        content_type=body.content_type[:120],
        size=body.size,
        object_key=object_key,
        wrapped_key=b"",
        nonce=nonce_bytes,
        sha256_checksum=body.sha256_checksum,
        ciphertext_sha256=body.ciphertext_sha256,
        encryption_version="v2",
        version=1,
        client_modified_at=datetime.now(timezone.utc),
        is_deleted=False,
        upload_status="pending",
        ciphertext_size=body.ciphertext_size,
        upload_expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.upload_intent_seconds),
    )
    reserve_storage(db, user.id, body.size)
    check_pending_limit(db, user.id)
    db.add(record)
    # S3 upload URLs only address staging keys. A still-valid PUT URL cannot
    # overwrite a finalized object's immutable key after confirmation.
    staging_key = object_key if isinstance(storage, LocalStorage) else f"_pending/{object_key}"
    try:
        presigned = storage.generate_presigned_upload(staging_key, content_type="application/octet-stream",
            expires_in=settings.upload_intent_seconds, content_length=body.ciphertext_size)
    except Exception:
        db.rollback()
        raise HTTPException(503, "Storage upload authorization is unavailable")
    deadline = as_utc(record.upload_expires_at) + timedelta(seconds=settings.transfer_timeout_seconds + 120)
    queue_cleanup(db, object_key, not_before=deadline)
    if staging_key != object_key:
        queue_cleanup(db, staging_key, not_before=deadline)
    db.commit()
    return {
        "file_id": record.id,
        "object_key": object_key,
        "upload_url": presigned["upload_url"],
        "upload_method": presigned["method"],
        "upload_headers": presigned.get("headers", {}),
        "mode": presigned["mode"],
        "expires_in": presigned["expires_in"],
    }

@app.post("/api/files/{file_id}/confirm-upload")
def confirm_upload(file_id: str, body: ConfirmUploadIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Finalize device-powered encrypted upload after ciphertext reaches object storage.
    """
    f = owned_file(file_id, user, db, include_pending=True)
    if f.encryption_version != "v2":
        raise HTTPException(409, "Only device-encrypted uploads can be confirmed")
    if body.ciphertext_sha256 and body.ciphertext_sha256 != f.ciphertext_sha256:
        raise HTTPException(422, "Confirmation checksum differs from the authorized upload")
    if f.upload_status == "ready":
        return safe_file(f)
    if not f.upload_expires_at or as_utc(f.upload_expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(410, "Upload authorization expired; cancel it and create a new upload")
    if f.upload_status not in {"pending", "uploaded"}:
        raise HTTPException(409, "Encrypted transfer is still in progress")
    staging_key = f.object_key if isinstance(storage, LocalStorage) else f"_pending/{f.object_key}"
    try:
        if not storage.exists(staging_key):
            raise HTTPException(400, "Encrypted payload has not yet been received in storage")
        size, checksum = storage.fingerprint(staging_key)
        if size != f.ciphertext_size or checksum != f.ciphertext_sha256:
            raise HTTPException(422, "Stored ciphertext size or checksum differs from the authorized upload")
        if not isinstance(storage, LocalStorage):
            storage.copy(staging_key, f.object_key)
            if storage.fingerprint(f.object_key) != (size, checksum):
                storage.delete(f.object_key)
                raise HTTPException(422, "Ciphertext changed during confirmation")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Encrypted storage verification is unavailable")
    sequence = next_change_sequence(db, user.id)
    result = db.execute(update(FileRecord).where(
        FileRecord.id == f.id, FileRecord.upload_status.in_(["pending", "uploaded"]),
        FileRecord.upload_expires_at > datetime.now(timezone.utc),
    ).values(upload_status="ready", upload_expires_at=None, client_modified_at=datetime.now(timezone.utc))
        .execution_options(synchronize_session=False))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "Upload state changed; refresh before confirming")
    db.refresh(f)
    f.client_modified_at = datetime.now(timezone.utc)
    record_change(db, f, sequence=sequence)
    activity(db, user, "file.uploaded_device_encrypted", f"Device-encrypted upload complete: {f.name}")
    record_access_log(
        db,
        action="file.uploaded_device_encrypted",
        file_id=f.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    notify(db, user, f"Encrypted transfer complete: {f.name}")
    db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == f.object_key))
    db.commit()
    # Staging cleanup waits until its PUT URL and possible in-flight transfer expire.
    return safe_file(f)


def authorized_share(token: str, request: Request, db: Session) -> tuple[ShareLink, FileRecord]:
    share = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token)))
    if not valid_share(share):
        raise HTTPException(404, "Share link is unavailable")
    file = db.get(FileRecord, share.file_id)
    if not file or file.is_deleted or file.upload_status != "ready":
        raise HTTPException(404, "File not found")
    if share.password_hash:
        proof = db.get(ShareGrant, digest(request.headers.get("X-Share-Grant", "")))
        if not proof or proof.share_id != share.id or as_utc(proof.expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(403, "Verify the share password before downloading")
    return share, file


def consume_shared_transfer(db: Session, share: ShareLink) -> None:
    result = db.execute(update(ShareLink).where(
        ShareLink.id == share.id, ShareLink.revoked.is_(False),
        ShareLink.password_hash == share.password_hash,
        or_(ShareLink.expires_at.is_(None), ShareLink.expires_at > datetime.now(timezone.utc)),
        or_(ShareLink.max_downloads.is_(None), ShareLink.downloads < ShareLink.max_downloads),
    ).values(downloads=ShareLink.downloads + 1).execution_options(synchronize_session="fetch"))
    if result.rowcount != 1:
        raise HTTPException(410, "Download limit reached or share link is unavailable")


def issue_download_intent(f: FileRecord, request: Request, db: Session, share: ShareLink | None = None, token: str | None = None) -> dict:
    result = {
        **safe_file(f), "file_id": f.id,
        "nonce_b64": base64.b64encode(f.nonce).decode(),
        "wrapped_key_b64": "", "expires_in": settings.storage_grant_seconds,
    }
    if f.encryption_version == "v1":
        result.update({"download_url": f"/api/shares/{token}/download" if share else f"/api/files/{f.id}/download",
                       "download_method": "POST" if share else "GET", "mode": "legacy_server_decryption",
                       "download_headers": {"X-Share-Grant": request.headers.get("X-Share-Grant", "")} if share else {}})
        return result
    try:
        if not storage.exists(f.object_key):
            raise HTTPException(503, "Encrypted file is unavailable in storage")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Encrypted storage is temporarily unavailable")
    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.query(StorageGrant).filter(StorageGrant.expires_at <= now).delete(synchronize_session=False)
    db.add(StorageGrant(token_hash=digest(raw), file_id=f.id, share_id=share.id if share else None,
                        session_hash=None if share else request.state.session.token_hash,
                        expires_at=now + timedelta(seconds=settings.storage_grant_seconds)))
    result.update({"download_url": f"/api/storage/raw/{f.object_key}", "download_method": "GET",
                   "download_headers": {"X-Storage-Grant": raw}, "mode": "authorized_ciphertext_stream"})
    return result

@app.get("/api/files/{file_id}/download-intent")
def download_intent(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Authorize direct ciphertext download from object storage to device.
    The device decrypts the file locally using its private or shared keys.
    """
    f = readable_file(file_id, user, db)
    intent = issue_download_intent(f, request, db)
    record_access_log(
        db,
        action="file.download_intent_granted",
        file_id=f.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    db.commit()
    return intent

@app.post("/api/shares/{token}/download-intent")
def shared_download_intent(token: str, request: Request, db: Session = Depends(get_db)):
    """
    Authorize direct encrypted download for a public share link recipient.
    Validates atomic download limits and optional Argon2id password protection.
    Recipient device decrypts ciphertext locally using the zero-knowledge key fragment.
    """
    share, file = authorized_share(token, request, db)
    intent = issue_download_intent(file, request, db, share, token)
    record_access_log(db, action="share.download_intent_granted", share_id=share.id, file_id=file.id,
                      ip_address=request.client.host if request.client else None,
                      user_agent=request.headers.get("user-agent"))
    db.commit()
    return intent

@app.put("/api/storage/raw/{object_key}")
async def put_raw_storage(object_key: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Direct raw ciphertext streaming receiver when using local storage adapter.
    Streams directly to disk without parsing, decrypting, or buffering in memory.
    """
    if not re.fullmatch(r"[a-fA-F0-9]{32,80}", object_key):
        raise HTTPException(400, "Invalid object key")
    if not isinstance(storage, LocalStorage):
        raise HTTPException(404, "Local upload storage is not enabled")
    record = db.scalar(select(FileRecord).where(FileRecord.object_key == object_key, FileRecord.owner_id == user.id))
    if not record:
        raise HTTPException(404, "Upload authorization not found")
    if record.encryption_version != "v2" or record.upload_status not in {"pending", "receiving"}:
        raise HTTPException(409, "This object is immutable or a transfer is already in progress")
    if not record.upload_expires_at or as_utc(record.upload_expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(410, "Upload authorization expired")
    now = datetime.now(timezone.utc)
    token = secrets.token_hex(16)
    lease = now + timedelta(seconds=settings.transfer_timeout_seconds + 120)
    claimed = db.execute(update(FileRecord).where(FileRecord.id == record.id, FileRecord.upload_expires_at > now,
        or_(FileRecord.upload_status == "pending", and_(FileRecord.upload_status == "receiving",
            or_(FileRecord.lease_expires_at.is_(None), FileRecord.lease_expires_at <= now))),
    ).values(upload_status="receiving", transfer_token=token, lease_expires_at=lease)
        .execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        raise HTTPException(409, "Transfer is already in progress")
    target = storage._resolve(object_key)
    temporary = target.with_name(f".{object_key}.{secrets.token_hex(8)}.part")
    temporary_key = temporary.relative_to(storage.root).as_posix()
    queue_cleanup(db, temporary_key, not_before=lease)
    db.commit()
    total_written = 0
    checksum = hashlib.sha256()
    try:
        with anyio.fail_after(settings.transfer_timeout_seconds), temporary.open("xb") as output:
            async for chunk in request.stream():
                total_written += len(chunk)
                if total_written > record.ciphertext_size or total_written > settings.max_upload_bytes + 16:
                    raise HTTPException(413, "Uploaded ciphertext exceeds its authorized size")
                checksum.update(chunk)
                output.write(chunk)
        if total_written != record.ciphertext_size or checksum.hexdigest() != record.ciphertext_sha256:
            raise HTTPException(422, "Uploaded ciphertext size or checksum does not match its authorization")
        state = db.execute(update(FileRecord).where(FileRecord.id == record.id,
            FileRecord.upload_status == "receiving", FileRecord.transfer_token == token,
            FileRecord.upload_expires_at > datetime.now(timezone.utc),
        ).values(upload_status="uploaded", transfer_token=None, lease_expires_at=None)
            .execution_options(synchronize_session=False))
        if state.rowcount != 1:
            raise HTTPException(409, "Upload was cancelled during transfer")
        os.replace(temporary, target)
        db.execute(delete(StorageCleanup).where(StorageCleanup.object_key == temporary_key))
        db.commit()
    except BaseException as error:
        temporary.unlink(missing_ok=True)
        db.rollback()
        db.execute(update(FileRecord).where(FileRecord.id == record.id, FileRecord.transfer_token == token)
                   .values(upload_status="pending", transfer_token=None, lease_expires_at=None))
        db.commit()
        if isinstance(error, TimeoutError):
            raise HTTPException(408, "Transfer timed out; retry the upload")
        raise
    return {"status": "stored", "bytes": total_written}

@app.get("/api/storage/raw/{object_key}")
def get_raw_storage(object_key: str, request: Request, db: Session = Depends(get_db)):
    """
    Direct raw ciphertext streaming download when using local storage adapter.
    Supports HTTP Range requests for resumable downloads.
    """
    if not re.fullmatch(r"[a-fA-F0-9]{32,80}", object_key):
        raise HTTPException(400, "Invalid object key")
    record = db.scalar(select(FileRecord).where(FileRecord.object_key == object_key,
                       FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(False)))
    grant_token = request.headers.get("X-Storage-Grant", "")
    grant = db.get(StorageGrant, digest(grant_token)) if grant_token else None
    share = None
    if grant_token:
        if not grant or not record or grant.file_id != record.id or as_utc(grant.expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(403, "Storage authorization is invalid or expired")
        if grant.session_hash:
            session = db.get(SessionRecord, grant.session_hash)
            if not session or as_utc(session.expires_at) <= datetime.now(timezone.utc):
                raise HTTPException(403, "Storage session expired")
            user = db.get(User, session.user_id)
            device = db.get(DeviceRecord, session.device_id) if session.device_id else None
            if (not user or (user.demo_expires_at and as_utc(user.demo_expires_at) <= datetime.now(timezone.utc))
                    or (session.device_id and (not device or device.revoked))):
                raise HTTPException(403, "Storage session expired or device revoked")
            readable_file(record.id, user, db)
        elif grant.share_id:
            share = db.get(ShareLink, grant.share_id)
            if not share or share.revoked or (share.expires_at and as_utc(share.expires_at) <= datetime.now(timezone.utc)):
                raise HTTPException(404, "Share link is unavailable")
        else:
            raise HTTPException(403, "Storage authorization is invalid")
    else:
        user = current_user(request, db)
        if not record:
            raise HTTPException(404, "Storage object not found")
        readable_file(record.id, user, db)
    try:
        file_size = storage.size(object_key)
        if file_size != (record.ciphertext_size or record.size + 16):
            raise ValueError("Stored size differs from the file metadata")
    except Exception:
        raise HTTPException(503, "Encrypted file is unavailable in storage")
    start, end, status = parse_range(request.headers.get("range"), file_size)
    stream = storage.iter_bytes(object_key, start, end)
    try:
        first = next(stream)
    except Exception:
        stream.close()
        raise HTTPException(503, "Encrypted transfer could not be started")
    try:
        if share and not grant.consumed:
            claimed = db.execute(update(StorageGrant).where(StorageGrant.token_hash == grant.token_hash,
                                 StorageGrant.consumed.is_(False)).values(consumed=True))
            if claimed.rowcount == 1:
                consume_shared_transfer(db, share)
                owner = db.get(User, record.owner_id)
                notify(db, owner, f"A shared file was downloaded: {record.name}")
                activity(db, owner, "share.downloaded", f"A recipient downloaded {record.name}")
        record_access_log(db, action="share.downloaded" if share else "file.downloaded_ciphertext",
                          file_id=record.id, share_id=share.id if share else None,
                          ip_address=request.client.host if request.client else None,
                          user_agent=request.headers.get("user-agent"))
        db.commit()
    except BaseException:
        stream.close()
        db.rollback()
        raise

    def response_stream():
        try:
            yield first
            yield from stream
        finally:
            stream.close()

    headers = {"Content-Length": str(end - start + 1), "Accept-Ranges": "bytes",
               "Content-Disposition": content_disposition(record.name), "Cache-Control": "no-store",
               "X-Content-Type-Options": "nosniff"}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    return StreamingResponse(response_stream(), status_code=status, media_type="application/octet-stream", headers=headers)

# ----------------- File Management Enhancements -----------------

def change_file(db: Session, file: FileRecord, values: dict, *, version: int | None = None) -> None:
    expected = file.version if version is None else version
    sequence = next_change_sequence(db, file.owner_id)
    result = db.execute(update(FileRecord).where(FileRecord.id == file.id,
        FileRecord.owner_id == file.owner_id, FileRecord.version == expected,
        FileRecord.upload_status == "ready", FileRecord.is_deleted == file.is_deleted,
    ).values(**values, version=FileRecord.version + 1, client_modified_at=datetime.now(timezone.utc)))
    if result.rowcount != 1:
        raise HTTPException(409, "File changed elsewhere; refresh before retrying")
    db.refresh(file)
    record_change(db, file, sequence=sequence)

@app.patch("/api/files/{file_id}")
def update_file_metadata(file_id: str, body: FileUpdateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Conflict-safe metadata update (rename) with optimistic concurrency control.
    """
    f = readable_file(file_id, user, db, edit=True)
    if body.version is not None and body.version != f.version:
        raise HTTPException(409, f"Conflict: current version is {f.version}")
    if body.name:
        change_file(db, f, {"name": clean_filename(body.name)}, version=body.version)
    activity(db, user, "file.renamed", f"Renamed file to {f.name}")
    db.commit()
    return safe_file(f)

@app.post("/api/files/{file_id}/trash")
def trash_file(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Soft-delete a file to the user's trash."""
    f = owned_file(file_id, user, db)
    change_file(db, f, {"is_deleted": True, "deleted_at": datetime.now(timezone.utc)})
    activity(db, user, "file.trashed", f"Moved {f.name} to trash")
    db.commit()
    return {"status": "trashed", "file": safe_file(f)}

@app.post("/api/files/{file_id}/restore")
def restore_file(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Restore a soft-deleted file from trash."""
    f = owned_file(file_id, user, db, include_trash=True)
    if f.is_deleted:
        change_file(db, f, {"is_deleted": False, "deleted_at": None})
    activity(db, user, "file.restored", f"Restored {f.name} from trash")
    db.commit()
    return {"status": "restored", "file": safe_file(f)}

@app.post("/api/files/{file_id}/copy", status_code=201)
def copy_file(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Copy ciphertext to an independent object without exposing a v2 key."""
    orig = readable_file(file_id, user, db)
    new_name = clean_filename(f"Copy of {orig.name}")
    object_key = secrets.token_hex(32)
    copy_record = FileRecord(
        id=str(uuid.uuid4()),
        owner_id=user.id,
        name=new_name,
        content_type=orig.content_type,
        size=orig.size,
        object_key=object_key,
        wrapped_key=orig.wrapped_key,
        nonce=orig.nonce,
        sha256_checksum=orig.sha256_checksum,
        ciphertext_sha256=orig.ciphertext_sha256,
        encryption_version=orig.encryption_version,
        version=1,
        is_deleted=False,
        ciphertext_size=orig.ciphertext_size or orig.size + 16,
        client_modified_at=datetime.now(timezone.utc),
    )
    start_server_file(db, copy_record)
    try:
        expected = storage.fingerprint(orig.object_key)
        if expected[0] != copy_record.ciphertext_size or (orig.ciphertext_sha256 and expected[1] != orig.ciphertext_sha256):
            raise HTTPException(422, "Source ciphertext failed its integrity check")
        storage.copy(orig.object_key, object_key)
        if storage.fingerprint(object_key) != expected:
            raise HTTPException(422, "Copied ciphertext failed its integrity check")
        copy_record.ciphertext_sha256 = expected[1]
        finish_server_file(db, copy_record, user, "file.copied", request)
    except HTTPException:
        discard_server_file(db, copy_record.id, user)
        raise
    except Exception:
        discard_server_file(db, copy_record.id, user)
        raise HTTPException(503, "File storage is unavailable; retry the copy")
    return {**safe_file(copy_record), "source_file_id": orig.id}

# ----------------- Device Registration & Synchronization -----------------

@app.post("/api/sync/device/register")
def register_device(body: DeviceRegisterIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Register or update a user device (mobile, web, desktop) for push and sync coordination.
    """
    dev = db.get(DeviceRecord, body.device_id)
    if not dev:
        dev = DeviceRecord(
            id=body.device_id,
            user_id=user.id,
            device_name=body.device_name,
            device_type=body.device_type,
            push_token=body.push_token,
            last_seen_at=datetime.now(timezone.utc),
            last_synced_at=datetime.now(timezone.utc),
        )
        db.add(dev)
    else:
        if dev.user_id != user.id:
            raise HTTPException(403, "Device ID already associated with another account")
        if dev.revoked:
            raise HTTPException(409, "This device was revoked. Register a new device ID after signing in again")
        dev.device_name = body.device_name
        dev.device_type = body.device_type
        if body.push_token:
            dev.push_token = body.push_token
        dev.last_seen_at = datetime.now(timezone.utc)
        dev.last_synced_at = datetime.now(timezone.utc)
    db.flush()
    active_session = request.state.session
    if active_session.device_id and active_session.device_id != dev.id:
        raise HTTPException(409, "Session is already bound to another device")
    active_session.device_id = dev.id
    db.commit()
    return {
        "id": dev.id,
        "device_name": dev.device_name,
        "device_type": dev.device_type,
        "last_synced_at": dev.last_synced_at.isoformat() if dev.last_synced_at else None,
    }

@app.get("/api/sync/devices")
def list_devices(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """List all active registered devices for current user."""
    devs = db.scalars(
        select(DeviceRecord)
        .where(DeviceRecord.user_id == user.id, DeviceRecord.revoked.is_(False))
        .order_by(DeviceRecord.last_seen_at.desc())
    ).all()
    return [
        {
            "id": d.id,
            "device_name": d.device_name,
            "device_type": d.device_type,
            "last_seen_at": d.last_seen_at.isoformat(),
            "last_synced_at": d.last_synced_at.isoformat() if d.last_synced_at else None,
            "created_at": d.created_at.isoformat(),
        }
        for d in devs
    ]

@app.delete("/api/sync/devices/{device_id}", status_code=204)
def revoke_device(device_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Revoke a device."""
    dev = db.get(DeviceRecord, device_id)
    if dev and dev.user_id == user.id:
        dev.revoked = True
        db.query(SessionRecord).filter(SessionRecord.device_id == device_id).delete(synchronize_session=False)
        activity(db, user, "device.revoked", f"Revoked device: {dev.device_name}")
        db.commit()

def touch_device(device_id: str | None, user: User, db: Session) -> None:
    if device_id:
        device = db.get(DeviceRecord, device_id)
        if not device or device.user_id != user.id or device.revoked:
            raise HTTPException(403, "Device is not registered or has been revoked")
        device.last_seen_at = datetime.now(timezone.utc)
        device.last_synced_at = datetime.now(timezone.utc)


@app.get("/api/sync/cursor")
def sync_cursor(since: str | None = None, device_id: str | None = None, limit: int = 100,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Account-scoped, commit-ordered journal pagination, including permanent tombstones."""
    if not 1 <= limit <= 500:
        raise HTTPException(422, "Limit must be 1–500")
    sequence, reset = 0, False
    if since:
        match = re.fullmatch(r"s1:([A-Za-z0-9_-]{1,36}):(\d{1,20})", since)
        if match:
            if match[1] != user.id:
                raise HTTPException(409, "Cursor belongs to a different account; restart synchronization")
            sequence = int(match[2])
        else:
            try:
                datetime.fromisoformat(since.replace("Z", "+00:00"))
                reset = True  # Upgrade valid legacy timestamp cursors to a full journal replay.
            except ValueError:
                raise HTTPException(422, "Invalid synchronization cursor")
    latest = db.scalar(select(User.sync_sequence).where(User.id == user.id))
    if sequence > latest:
        raise HTTPException(409, "Cursor is ahead of the server; restart synchronization")
    changes = list(db.scalars(select(FileChange).where(FileChange.user_id == user.id,
        FileChange.sequence > sequence, FileChange.sequence <= latest).order_by(FileChange.sequence).limit(limit + 1)))
    more = len(changes) > limit
    page = changes[:limit]
    cursor_sequence = page[-1].sequence if more else latest
    touch_device(device_id, user, db)
    db.commit()
    return {"cursor": f"s1:{user.id}:{cursor_sequence}", "files": [change.payload for change in page],
            "changes": [{"sequence": change.sequence, "file": change.payload} for change in page],
            "server_time": datetime.now(timezone.utc).isoformat(), "has_more": more, "reset_required": reset}

@app.post("/api/sync/batch")
def sync_batch(body: SyncBatchIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """
    Apply offline batched changes (renames, deletions) with conflict detection.
    """
    results = {"renamed": [], "deleted": [], "conflicts": []}
    reserve_storage(db, user.id, 0)  # One owner lock orders the whole batch with other mutations.
    touch_device(body.device_id, user, db)
    for item in body.renames:
        fid = item.file_id
        f = db.scalar(select(FileRecord).where(FileRecord.id == fid, FileRecord.owner_id == user.id,
                       FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(False)))
        if not f or f.version != item.version:
            results["conflicts"].append({"file_id": fid, "server_version": f.version if f else None,
                                        "server_name": f.name if f else None, "reason": "File missing or changed"})
        else:
            change_file(db, f, {"name": clean_filename(item.name)}, version=item.version)
            results["renamed"].append({"file_id": fid, "version": f.version})

    for item in body.deletions:
        fid = item.file_id
        f = db.scalar(select(FileRecord).where(FileRecord.id == fid, FileRecord.owner_id == user.id,
                       FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(False)))
        if not f or f.version != item.version:
            results["conflicts"].append({"file_id": fid, "server_version": f.version if f else None,
                                        "reason": "File missing or changed"})
        else:
            change_file(db, f, {"is_deleted": True, "deleted_at": datetime.now(timezone.utc)}, version=item.version)
            results["deleted"].append({"file_id": fid, "version": f.version})

    db.commit()
    return results

@app.get("/api/sync/status")
def sync_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Summary of cloud storage, active/trashed files, and device status."""
    active_files = db.scalar(select(func.count(FileRecord.id)).where(FileRecord.owner_id == user.id, FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(False)))
    trashed_files = db.scalar(select(func.count(FileRecord.id)).where(FileRecord.owner_id == user.id, FileRecord.upload_status == "ready", FileRecord.is_deleted.is_(True)))
    usage = storage_usage(user, db)
    devices_count = db.scalar(select(func.count(DeviceRecord.id)).where(DeviceRecord.user_id == user.id, DeviceRecord.revoked.is_(False)))

    return {
        "active_files_count": active_files or 0,
        "trashed_files_count": trashed_files or 0,
        "total_bytes_used": usage["bytes"],
        "quota_bytes": settings.account_quota_bytes,
        "active_bytes": usage["active_bytes"], "trash_bytes": usage["trash_bytes"], "pending_bytes": usage["pending_bytes"],
        "registered_devices_count": devices_count or 0,
        "server_time": datetime.now(timezone.utc).isoformat(),
    }

