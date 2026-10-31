import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

def generate_totp_secret() -> str:
    """Generate a random Base32 encoded 20-byte secret."""
    raw = secrets.token_bytes(20)
    return base64.b32encode(raw).decode("utf-8").replace("=", "")

def get_totp_code(secret: str, for_time: int | None = None, interval: int = 30, digits: int = 6) -> str:
    """Generate standard RFC 6238 TOTP code."""
    if for_time is None:
        for_time = int(time.time())
    counter = int(for_time // interval)
    
    # Pad secret if padding is missing
    padded_secret = secret.upper()
    missing_padding = len(padded_secret) % 8
    if missing_padding:
        padded_secret += "=" * (8 - missing_padding)
        
    key = base64.b32decode(padded_secret, casefold=True)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return f"{code_int:0{digits}d}"

def verify_totp_code(secret: str, code: str, window: int = 1, interval: int = 30) -> bool:
    """Verify TOTP code within +/- window intervals."""
    code = code.strip()
    if not code.isdigit() or len(code) != 6:
        return False
    current_time = int(time.time())
    for offset in range(-window, window + 1):
        target_time = current_time + (offset * interval)
        if hmac.compare_digest(get_totp_code(secret, target_time, interval), code):
            return True
    return False

def generate_recovery_codes(count: int = 8) -> list[str]:
    """Generate formatted recovery codes (e.g. 1234-5678)."""
    codes = []
    for _ in range(count):
        part1 = secrets.token_hex(2).upper()
        part2 = secrets.token_hex(2).upper()
        codes.append(f"{part1}-{part2}")
    return codes

def hash_recovery_code(code: str) -> str:
    """Hash recovery code using SHA-256."""
    normalized = code.strip().upper().replace(" ", "").replace("-", "")
    return hashlib.sha256(normalized.encode()).hexdigest()

def verify_recovery_code(hashed_codes: list[str], code: str) -> tuple[bool, list[str]]:
    """Check if code matches any hashed recovery code and consume it."""
    chash = hash_recovery_code(code)
    for idx, stored in enumerate(hashed_codes):
        if hmac.compare_digest(stored, chash):
            remaining = [c for i, c in enumerate(hashed_codes) if i != idx]
            return True, remaining
    return False, hashed_codes

def get_provisioning_uri(secret: str, email: str, issuer: str = "CloudVault") -> str:
    """Generate standard otpauth URI."""
    encoded_issuer = quote(issuer)
    encoded_email = quote(email)
    return f"otpauth://totp/{encoded_issuer}:{encoded_email}?secret={secret}&issuer={encoded_issuer}&algorithm=SHA1&digits=6&period=30"
