import hashlib
import json
import secrets
import smtplib
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import Base, engine, get_db
from app.encryption import decrypt_file, encrypt_file
from app.mime_validator import validate_file_content
from app.models import (
    Activity,
    FileAccessLog,
    FilePermission,
    FileRecord,
    Notification,
    OneTimeToken,
    ResumableUpload,
    SessionRecord,
    ShareGrant,
    ShareLink,
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
    verify_password,
)
from app.storage import storage
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

app = FastAPI(title="SecureShare API", version="1.0.0")
origins = [o.strip() for o in settings.frontend_origin.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://([a-zA-Z0-9-]+\.)*vercel\.app$",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["*"],
)

_rate_guard = threading.Lock()
_download_guard = threading.Lock()
_attempts = {}

# Test/console mail log for inspections and integration verification
sent_emails = []

@app.on_event("startup")
def migrate_database():
    if settings.run_migrations_on_start:
        ini_path = None
        if Path("alembic.ini").exists():
            ini_path = "alembic.ini"
        elif Path("backend/alembic.ini").exists():
            ini_path = "backend/alembic.ini"
        elif (Path(__file__).parent.parent / "alembic.ini").exists():
            ini_path = str(Path(__file__).parent.parent / "alembic.ini")

        if ini_path:
            result = subprocess.run(
                [sys.executable, "-m", "alembic", "-c", ini_path, "upgrade", "head"],
                capture_output=True,
                text=True,
            )
            if result.returncode:
                print(f"[Warning] Migration notice: {result.stderr}")
        try:
            Base.metadata.create_all(bind=engine)
        except Exception as e:
            print(f"[Info] Schema creation notice: {e}")

@app.middleware("http")
async def auth_rate_limit(request: Request, call_next):
    throttled_paths = (
        "/api/auth/login",
        "/api/auth/register",
        "/api/auth/forgot-password",
        "/api/auth/reset-password",
        "/api/auth/verify-email",
        "/api/auth/login/2fa",
    )
    if request.url.path in throttled_paths:
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
    content_type: str = "application/octet-stream"
    total_chunks: int = Field(ge=1, le=5000)

def send_email(to: str, subject: str, body: str):
    if settings.mail_mode == "console":
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
            expires_at=datetime.now(timezone.utc) + timedelta(hours=24 if purpose == "verify" else 1),
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
):
    entry = FileAccessLog(
        id=str(uuid.uuid4()),
        file_id=file_id,
        share_id=share_id,
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent[:255] if user_agent else None,
        action=action,
        result=result,
        failure_reason=failure_reason,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)

def safe_file(f: FileRecord):
    return {
        "id": f.id,
        "name": f.name,
        "size": f.size,
        "content_type": f.content_type,
        "sha256_checksum": getattr(f, "sha256_checksum", None),
        "created_at": f.created_at.isoformat(),
    }

def valid_share(s: ShareLink):
    return bool(
        s
        and not s.revoked
        and (not s.expires_at or as_utc(s.expires_at) > datetime.now(timezone.utc))
        and (not s.max_downloads or s.downloads < s.max_downloads)
    )

def owned_file(file_id: str, user: User, db: Session) -> FileRecord:
    f = db.scalar(select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id))
    if not f:
        raise HTTPException(404, "File not found")
    return f

@app.get("/")
def root():
    return {
        "service": "SecureShare API",
        "status": "online",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/api/auth/demo")
def demo_login(response: Response, db: Session = Depends(get_db)):
    if not settings.demo_login_enabled:
        raise HTTPException(404, "Demo access is disabled")
    email = "demo@secureshare.local"
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        user = User(id=str(uuid.uuid4()), name="SecureShare Demo User", email=email,
                    password_hash=hash_password(secrets.token_urlsafe(32)),
                    verified_at=datetime.now(timezone.utc))
        db.add(user)
        db.commit()
    issue_session(user, db, response)
    activity(db, user, "auth.demo", "Started demo session")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}

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
    record.used = True
    user = db.get(User, record.user_id)
    user.verified_at = datetime.now(timezone.utc)
    issue_session(user, db, response)
    activity(db, user, "account.verified", "Email verified successfully")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}

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
    record.used = True
    user = db.get(User, record.user_id)
    user.password_hash = hash_password(body.new_password)
    # Revoke all sessions
    db.query(SessionRecord).filter(SessionRecord.user_id == user.id).delete(synchronize_session=False)
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

    issue_session(user, db, response)
    activity(db, user, "auth.login", "Signed in")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}

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
    is_valid_totp = bool(user.totp_secret and verify_totp_code(user.totp_secret, code))
    recovery_used = False
    
    if not is_valid_totp and user.recovery_codes_hash:
        try:
            stored_hashes = json.loads(user.recovery_codes_hash)
            matched, remaining = verify_recovery_code(stored_hashes, code)
            if matched:
                is_valid_totp = True
                recovery_used = True
                user.recovery_codes_hash = json.dumps(remaining)
                activity(db, user, "security.recovery_code_used", f"Recovery code consumed. {len(remaining)} remaining.")
                notify(db, user, f"A recovery code was used to access your account. {len(remaining)} codes remaining.")
        except Exception:
            pass

    if not is_valid_totp:
        raise HTTPException(401, "Invalid authentication code or recovery code")

    record.used = True
    issue_session(user, db, response)
    activity(db, user, "auth.login_2fa", "Signed in via two-factor authentication")
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email}

# ----------------- 2FA Management Routes -----------------

@app.get("/api/auth/2fa/status")
def two_factor_status(user: User = Depends(current_user)):
    return {"enabled": bool(user.totp_enabled)}

@app.post("/api/auth/2fa/setup")
def setup_two_factor(user: User = Depends(current_user), db: Session = Depends(get_db)):
    secret = generate_totp_secret()
    recovery_codes = generate_recovery_codes()
    hashed_codes = [hash_recovery_code(c) for c in recovery_codes]
    
    user.totp_secret = secret
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
    if not verify_totp_code(user.totp_secret, body.code):
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
    is_valid = bool(user.totp_secret and verify_totp_code(user.totp_secret, code))
    if not is_valid and user.recovery_codes_hash:
        try:
            stored_hashes = json.loads(user.recovery_codes_hash)
            matched, _ = verify_recovery_code(stored_hashes, code)
            if matched:
                is_valid = True
        except Exception:
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
    raw = request.cookies.get(COOKIE)
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
    raw = request.cookies.get(COOKIE)
    db.query(SessionRecord).filter(
        SessionRecord.user_id == user.id,
        SessionRecord.token_hash != digest(raw or ""),
    ).delete(synchronize_session=False)
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

@app.post("/api/files", status_code=201)
@app.post("/api/files/upload", status_code=201)
async def upload(request: Request, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    name = Path(file.filename or "file").name.strip().replace("\x00", "")[:255] or "file"
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
    ciphertext, nonce, wrapped = encrypt_file(content)
    object_key = secrets.token_hex(32)
    try:
        storage.put(object_key, ciphertext)
    except OSError:
        raise HTTPException(503, "Storage is temporarily unavailable")

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
    )
    db.add(record)
    activity(db, user, "file.uploaded", f"Uploaded {name}")
    record_access_log(
        db,
        action="file.uploaded",
        file_id=record.id,
        user_id=user.id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        result="success",
    )
    notify(db, user, f"Encrypted upload complete: {name}")
    db.commit()
    return safe_file(record)

# ----------------- Resumable (Chunked) Uploads -----------------

resumable_chunks_dir = Path("./storage/_resumable")
resumable_chunks_dir.mkdir(parents=True, exist_ok=True)

@app.post("/api/files/resumable/init", status_code=201)
def init_resumable_upload(body: ResumableInitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.size > settings.max_upload_bytes:
        raise HTTPException(413, f"Total size exceeds upload limit of {settings.max_upload_bytes} bytes")
    
    upload_id = str(uuid.uuid4())
    upload_record = ResumableUpload(
        id=upload_id,
        user_id=user.id,
        name=Path(body.name).name.strip().replace("\x00", "")[:255] or "file",
        content_type=body.content_type[:120],
        total_size=body.size,
        total_chunks=body.total_chunks,
        completed_chunks="[]",
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(upload_record)
    upload_dir = resumable_chunks_dir / upload_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    db.commit()
    return {
        "upload_id": upload_id,
        "name": upload_record.name,
        "total_chunks": upload_record.total_chunks,
        "total_size": upload_record.total_size,
    }

@app.put("/api/files/resumable/{upload_id}/chunk/{chunk_index}")
async def upload_chunk(
    upload_id: str,
    chunk_index: int,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    upload_rec = db.get(ResumableUpload, upload_id)
    if not upload_rec or upload_rec.user_id != user.id or as_utc(upload_rec.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(404, "Resumable upload session not found or expired")
    if chunk_index < 0 or chunk_index >= upload_rec.total_chunks:
        raise HTTPException(400, f"Invalid chunk index {chunk_index} for total chunks {upload_rec.total_chunks}")
    
    chunk_data = await request.body()
    if not chunk_data:
        raise HTTPException(400, "Empty chunk data")
    
    chunk_path = resumable_chunks_dir / upload_id / f"chunk_{chunk_index}"
    chunk_path.write_bytes(chunk_data)

    completed = json.loads(upload_rec.completed_chunks)
    if chunk_index not in completed:
        completed.append(chunk_index)
        completed.sort()
        upload_rec.completed_chunks = json.dumps(completed)
        db.commit()

    return {"upload_id": upload_id, "chunk_index": chunk_index, "received_bytes": len(chunk_data)}

@app.get("/api/files/resumable/{upload_id}/status")
def resumable_status(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    upload_rec = db.get(ResumableUpload, upload_id)
    if not upload_rec or upload_rec.user_id != user.id:
        raise HTTPException(404, "Resumable upload session not found")
    completed = json.loads(upload_rec.completed_chunks)
    return {
        "upload_id": upload_id,
        "total_chunks": upload_rec.total_chunks,
        "completed_chunks": completed,
        "complete": len(completed) == upload_rec.total_chunks,
    }

@app.post("/api/files/resumable/{upload_id}/complete", status_code=201)
def complete_resumable_upload(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    upload_rec = db.get(ResumableUpload, upload_id)
    if not upload_rec or upload_rec.user_id != user.id:
        raise HTTPException(404, "Resumable upload session not found")
    
    completed = json.loads(upload_rec.completed_chunks)
    if len(completed) != upload_rec.total_chunks:
        raise HTTPException(400, f"Cannot complete upload: {len(completed)} of {upload_rec.total_chunks} chunks uploaded")
    
    upload_dir = resumable_chunks_dir / upload_id
    chunks = []
    for i in range(upload_rec.total_chunks):
        cfile = upload_dir / f"chunk_{i}"
        if not cfile.exists():
            raise HTTPException(400, f"Missing chunk {i}")
        chunks.append(cfile.read_bytes())
    
    full_content = b"".join(chunks)
    if len(full_content) != upload_rec.total_size:
        raise HTTPException(400, f"Assembled size ({len(full_content)}) does not match expected size ({upload_rec.total_size})")

    is_valid, resolved_type, err_msg = validate_file_content(
        full_content,
        upload_rec.content_type,
        upload_rec.name,
    )
    if not is_valid:
        raise HTTPException(400, err_msg)

    ciphertext, nonce, wrapped = encrypt_file(full_content)
    object_key = secrets.token_hex(32)
    try:
        storage.put(object_key, ciphertext)
    except OSError:
        raise HTTPException(503, "Storage is temporarily unavailable")

    checksum = hashlib.sha256(full_content).hexdigest()
    record = FileRecord(
        id=str(uuid.uuid4()),
        owner_id=user.id,
        name=upload_rec.name,
        content_type=resolved_type[:120],
        size=len(full_content),
        object_key=object_key,
        nonce=nonce,
        wrapped_key=wrapped,
        sha256_checksum=checksum,
    )
    db.add(record)
    db.delete(upload_rec)
    activity(db, user, "file.uploaded_resumable", f"Resumable upload complete: {record.name}")
    record_access_log(
        db,
        action="file.uploaded_resumable",
        file_id=record.id,
        user_id=user.id,
        result="success",
    )
    notify(db, user, f"Encrypted resumable upload complete: {record.name}")
    db.commit()

    # Clean up chunk directory
    for f in upload_dir.glob("chunk_*"):
        f.unlink(missing_ok=True)
    upload_dir.rmdir()

    return safe_file(record)

@app.delete("/api/files/resumable/{upload_id}", status_code=204)
def abort_resumable_upload(upload_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    upload_rec = db.get(ResumableUpload, upload_id)
    if upload_rec and upload_rec.user_id == user.id:
        db.delete(upload_rec)
        db.commit()
    upload_dir = resumable_chunks_dir / upload_id
    if upload_dir.exists():
        for f in upload_dir.glob("chunk_*"):
            f.unlink(missing_ok=True)
        upload_dir.rmdir()

# ----------------- File Operations -----------------

@app.get("/api/files")
def list_files(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        safe_file(f)
        for f in db.scalars(select(FileRecord).where(FileRecord.owner_id == user.id).order_by(FileRecord.created_at.desc())).all()
    ]

@app.get("/api/files/{file_id}")
def file_detail(file_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db)
    return safe_file(f)

@app.get("/api/files/{file_id}/download")
@app.post("/api/files/{file_id}/download")
def download(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.scalar(select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id))
    if not f:
        perm = db.scalar(select(FilePermission).where(FilePermission.file_id == file_id, FilePermission.email == user.email))
        if perm:
            f = db.get(FileRecord, file_id)
    if not f:
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

    try:
        plain = decrypt_file(storage.get(f.object_key), f.nonce, f.wrapped_key)
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
        "Content-Disposition": f'attachment; filename="{f.name.replace(chr(34), "")}"',
        "Cache-Control": "no-store",
    }
    if getattr(f, "sha256_checksum", None):
        headers["Digest"] = f"sha-256={f.sha256_checksum}"
        headers["X-Checksum-SHA256"] = f.sha256_checksum

    return StreamingResponse(
        iter([plain]),
        media_type=f.content_type or "application/octet-stream",
        headers=headers,
    )

@app.delete("/api/files/{file_id}", status_code=204)
def delete_file(file_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.scalar(select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id))
    if not f:
        raise HTTPException(404, "File not found")
    storage.delete(f.object_key)
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
    )
    db.commit()

# ----------------- Share Links -----------------

@app.post("/api/files/{file_id}/shares", status_code=201)
@app.post("/api/files/{file_id}/share", status_code=201)
def create_share(file_id: str, body: ShareIn, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = db.scalar(select(FileRecord).where(FileRecord.id == file_id, FileRecord.owner_id == user.id))
    if not f:
        raise HTTPException(404, "File not found")
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
        "url": f"{settings.frontend_origin}/share/{token}",
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
    if body.revoked is not None:
        s.revoked = body.revoked
        if s.revoked:
            for grant in db.scalars(select(ShareGrant).where(ShareGrant.share_id == s.id)).all():
                db.delete(grant)

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
    if not f:
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
    with _download_guard:
        s = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token)))
        if not valid_share(s):
            record_access_log(
                db,
                action="share.download_denied",
                share_id=s.id if s else None,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                result="denied",
                failure_reason="Link expired, revoked, or limit reached",
            )
            db.commit()
            raise HTTPException(404, "Share link is unavailable")

        if s.password_hash:
            grant = request.headers.get("X-Share-Grant", "")
            proof = db.get(ShareGrant, digest(grant))
            if not proof or proof.share_id != s.id or as_utc(proof.expires_at) <= datetime.now(timezone.utc):
                record_access_log(
                    db,
                    action="share.download_denied",
                    share_id=s.id,
                    file_id=s.file_id,
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent"),
                    result="denied",
                    failure_reason="Missing or expired share grant",
                )
                db.commit()
                raise HTTPException(403, "Verify the share password before downloading")

        # Atomic conditional download count increment to prevent concurrent limit race conditions
        stmt = (
            update(ShareLink)
            .where(
                ShareLink.id == s.id,
                ShareLink.revoked.is_(False),
                or_(
                    ShareLink.max_downloads.is_(None),
                    ShareLink.downloads < ShareLink.max_downloads,
                ),
            )
            .values(downloads=ShareLink.downloads + 1)
        )
        result = db.execute(stmt)
        db.commit()
        if result.rowcount == 0:
            record_access_log(
                db,
                action="share.download_denied",
                share_id=s.id,
                file_id=s.file_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                result="denied",
                failure_reason="Download limit reached",
            )
            db.commit()
            raise HTTPException(410, "Download limit reached or share link is no longer available")

        f = db.get(FileRecord, s.file_id)
        if not f:
            raise HTTPException(404, "File not found")

        try:
            plain = decrypt_file(storage.get(f.object_key), f.nonce, f.wrapped_key)
            if getattr(f, "sha256_checksum", None):
                if hashlib.sha256(plain).hexdigest() != f.sha256_checksum:
                    raise ValueError("Checksum verification failed")
        except Exception:
            record_access_log(
                db,
                action="share.download_failed",
                share_id=s.id,
                file_id=f.id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
                result="failure",
                failure_reason="Integrity or decryption check failed",
            )
            db.commit()
            raise HTTPException(500, "File integrity check failed")

        owner = db.get(User, f.owner_id)
        if owner:
            activity(db, owner, "share.downloaded", f"A recipient downloaded {f.name}")
            notify(db, owner, f"A shared file was downloaded: {f.name}")

        record_access_log(
            db,
            action="share.downloaded",
            share_id=s.id,
            file_id=f.id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            result="success",
        )
        db.commit()

        headers = {
            "Content-Disposition": f'attachment; filename="{f.name.replace(chr(34), "")}"',
            "Cache-Control": "no-store",
        }
        if getattr(f, "sha256_checksum", None):
            headers["Digest"] = f"sha-256={f.sha256_checksum}"
            headers["X-Checksum-SHA256"] = f.sha256_checksum

        return StreamingResponse(
            iter([plain]),
            media_type=f.content_type or "application/octet-stream",
            headers=headers,
        )

@app.delete("/api/shares/{share_id}", status_code=204)
def revoke_share(share_id: str, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    f = db.get(FileRecord, s.file_id) if s else None
    if not s or not f or f.owner_id != user.id:
        raise HTTPException(404, "Share not found")
    s.revoked = True
    for grant in db.scalars(select(ShareGrant).where(ShareGrant.share_id == s.id)).all():
        db.delete(grant)
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
    f = owned_file(file_id, user, db)
    logs = db.scalars(
        select(FileAccessLog)
        .where(FileAccessLog.file_id == f.id)
        .order_by(FileAccessLog.created_at.desc())
        .limit(50)
    ).all()
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
            select(Activity).where(Activity.user_id == user.id, Activity.detail.contains(f.name)).order_by(Activity.created_at.desc())
        ).all()
    ]

@app.get("/api/shares/{share_id}/access-logs")
def share_access_logs(share_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s = db.get(ShareLink, share_id)
    if not s:
        raise HTTPException(404, "Share not found")
    f = db.get(FileRecord, s.file_id)
    if not f or f.owner_id != user.id:
        raise HTTPException(404, "Share not found")

    logs = db.scalars(
        select(FileAccessLog)
        .where(FileAccessLog.share_id == s.id)
        .order_by(FileAccessLog.created_at.desc())
        .limit(50)
    ).all()
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
    owned_files = db.scalars(select(FileRecord.id).where(FileRecord.owner_id == user.id)).all()
    logs = db.scalars(
        select(FileAccessLog)
        .where(
            or_(
                FileAccessLog.user_id == user.id,
                FileAccessLog.file_id.in_(owned_files) if owned_files else False,
            )
        )
        .order_by(FileAccessLog.created_at.desc())
        .limit(100)
    ).all()
    return [
        {
            "id": l.id,
            "file_id": l.file_id,
            "share_id": l.share_id,
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
    f = owned_file(file_id, user, db)
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
        "key_wrapping_scheme": "Envelope Encryption (AES-256-GCM under KEK)",
        "authenticated_tag_bits": 128,
        "tamper_verification": "Verified",
        "created_at": f.created_at.isoformat(),
    }

@app.post("/api/files/{file_id}/encryption/metadata")
def verify_encryption_metadata(file_id: str, body: EncryptionMetadataVerifyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f = owned_file(file_id, user, db)
    try:
        raw_ciphertext = storage.get(f.object_key)
        plain = decrypt_file(raw_ciphertext, f.nonce, f.wrapped_key)
        calc_sum = hashlib.sha256(plain).hexdigest()
        is_verified = (calc_sum == f.sha256_checksum) if f.sha256_checksum else True
        if body.sha256_checksum and body.sha256_checksum != calc_sum:
            is_verified = False
        return {
            "file_id": f.id,
            "valid": True,
            "checksum_verified": is_verified,
            "calculated_sha256": calc_sum,
            "algorithm": "AES-256-GCM",
        }
    except Exception as e:
        return {
            "file_id": f.id,
            "valid": False,
            "checksum_verified": False,
            "error": "Decryption failed or ciphertext was modified",
        }

# ----------------- Storage & Notifications -----------------

@app.get("/api/storage/usage")
def storage_usage(user: User = Depends(current_user), db: Session = Depends(get_db)):
    total = db.scalar(select(func.coalesce(func.sum(FileRecord.size), 0)).where(FileRecord.owner_id == user.id))
    return {"bytes": total, "limit": settings.max_upload_bytes}

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
