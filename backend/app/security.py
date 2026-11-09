import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session
from app.core.config import settings
from app.database import get_db
from app.models import DeviceRecord, SessionRecord, User

hasher = PasswordHasher()
COOKIE = "secureshare_session"

def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()

def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

def hash_password(password: str) -> str:
    return hasher.hash(password)

def verify_password(encoded: str, password: str) -> bool:
    try:
        return hasher.verify(encoded, password)
    except (VerifyMismatchError, VerificationError):
        return False

def issue_session(user: User, db: Session, response: Response, *, lifetime: timedelta | None = None) -> str:
    raw = secrets.token_urlsafe(32)
    lifetime = lifetime or timedelta(days=settings.session_days)
    db.add(SessionRecord(token_hash=digest(raw), user_id=user.id, expires_at=datetime.now(timezone.utc) + lifetime))
    samesite_mode = settings.cookie_samesite.lower()
    is_secure = settings.cookie_secure or (samesite_mode == "none")
    response.set_cookie(
        COOKIE,
        raw,
        httponly=True,
        secure=is_secure,
        samesite=samesite_mode,
        max_age=int(lifetime.total_seconds()),
        path="/"
    )
    return raw

def clear_session_cookie(response: Response):
    samesite_mode = settings.cookie_samesite.lower()
    is_secure = settings.cookie_secure or (samesite_mode == "none")
    response.delete_cookie(
        COOKIE,
        path="/",
        httponly=True,
        secure=is_secure,
        samesite=samesite_mode
    )

def session_token(request: Request) -> str | None:
    """Use the same credential selection for authentication and revocation."""
    auth_header = request.headers.get("Authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() == "bearer":
        return token.strip() or None
    if request.headers.get("X-Session-Token"):
        return request.headers["X-Session-Token"].strip() or None
    return request.cookies.get(COOKIE)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    raw = session_token(request)
    if not raw:
        raise HTTPException(401, "Authentication required")
    record = db.get(SessionRecord, digest(raw))
    if not record or as_utc(record.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(401, "Session expired")
    if record.device_id:
        device = db.get(DeviceRecord, record.device_id)
        if not device or device.revoked or device.user_id != record.user_id:
            raise HTTPException(401, "Device session revoked")
    user = db.get(User, record.user_id)
    if not user:
        raise HTTPException(401, "Authentication required")
    if user.demo_expires_at and as_utc(user.demo_expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(401, "Demo account expired")
    request.state.session = record
    return user
