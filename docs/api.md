# SecureShare REST API Documentation

The SecureShare API provides RESTful endpoints with OpenAPI 3.0 specification available interactively at `/docs` or `/redoc`.

All requests expecting JSON input must include `Content-Type: application/json`. Authenticated endpoints rely on secure, HttpOnly session cookies (`secureshare_session`).

---

## 1. System Health & Demo

### `GET /health`
Returns service status.
- **Response**: `200 OK`
```json
{
  "status": "ok"
}
```

### `POST /api/auth/demo`
Instantly provisions and signs into an ephemeral demonstration account.
- **Response**: `200 OK` (sets `secureshare_session` HttpOnly cookie)
```json
{
  "id": "c1f7a0b3-...",
  "name": "SecureShare Demo User",
  "email": "demo@secureshare.local"
}
```

---

## 2. Authentication Endpoints

### `POST /api/auth/register`
Creates a new user account and dispatches verification token.
- **Request Body**:
```json
{
  "name": "Alice Engineer",
  "email": "alice@example.com",
  "password": "Password123456!"
}
```
- **Response**: `201 Created`

### `POST /api/auth/login`
Authenticates with email and password. If 2FA is active, returns challenge token.
- **Request Body**:
```json
{
  "email": "alice@example.com",
  "password": "Password123456!"
}
```
- **Response**: `200 OK` or `200 OK` with 2FA requirement:
```json
{
  "require_2fa": true,
  "challenge_token": "a4f89d..."
}
```

### `POST /api/auth/login/2fa`
Completes login challenge with TOTP or recovery code.
- **Request Body**:
```json
{
  "challenge_token": "a4f89d...",
  "code": "123456"
}
```

### `POST /api/auth/logout`
Revokes current session cookie.
- **Response**: `204 No Content`

### `GET /api/auth/me`
Retrieves authenticated user profile.
- **Response**: `200 OK`
```json
{
  "id": "c1f7a0b3-...",
  "name": "Alice Engineer",
  "email": "alice@example.com"
}
```

### `POST /api/auth/2fa/setup`
Initializes Two-Factor Authentication configuration.
- **Response**: `200 OK`
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "otpauth_url": "otpauth://totp/SecureShare:alice@example.com?secret=...",
  "recovery_codes": ["a1b2c3d4", "e5f6g7h8", "..."]
}
```

---

## 3. File Operations

### `POST /api/files` or `POST /api/files/upload`
Uploads and encrypts a file using AES-256-GCM.
- **Headers**: `multipart/form-data`
- **Form Fields**: `file` (binary payload)
- **Response**: `201 Created`
```json
{
  "id": "e8d4a9...",
  "name": "Financial_Report.pdf",
  "size": 48120,
  "content_type": "application/pdf",
  "sha256_checksum": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  "created_at": "2026-10-31T14:00:00Z"
}
```

### `GET /api/files`
Lists files owned by the authenticated user.
- **Response**: `200 OK`

### `GET /api/files/{file_id}`
Retrieves file metadata.
- **Response**: `200 OK`

### `GET /api/files/{file_id}/download` or `POST /api/files/{file_id}/download`
Decrypts and streams file bytes. Returns `Digest: sha-256=...` and `Content-Disposition` attachment headers.
- **Response**: `200 OK` (binary stream)

### `DELETE /api/files/{file_id}`
Deletes file object and database record.
- **Response**: `204 No Content`

---

## 4. Encryption Metadata & Integrity

### `GET /api/files/{file_id}/encryption/metadata`
Inspects cryptographic envelope metadata without revealing secret keys.
- **Response**: `200 OK`
```json
{
  "file_id": "e8d4a9...",
  "name": "Financial_Report.pdf",
  "algorithm": "AES-256-GCM",
  "cipher_mode": "Authenticated Encryption with Associated Data (AEAD)",
  "key_length_bits": 256,
  "nonce_length_bytes": 12,
  "nonce_hex": "7a3f81e2...",
  "wrapped_key_size_bytes": 48,
  "sha256_checksum": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  "file_size_bytes": 48120,
  "key_wrapping_scheme": "Envelope Encryption (AES-256-GCM under KEK)",
  "authenticated_tag_bits": 128,
  "tamper_verification": "Verified",
  "created_at": "2026-10-31T14:00:00Z"
}
```

### `POST /api/files/{file_id}/encryption/metadata`
Validates ciphertext authenticity and SHA-256 checksum integrity.
- **Response**: `200 OK`
```json
{
  "file_id": "e8d4a9...",
  "valid": true,
  "checksum_verified": true,
  "calculated_sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  "algorithm": "AES-256-GCM"
}
```

---

## 5. Sharing & Permissions

### `POST /api/files/{file_id}/shares` or `POST /api/files/{file_id}/share`
Generates a secure sharing link.
- **Request Body**:
```json
{
  "expires_in_hours": 24,
  "max_downloads": 5,
  "password": "OptionalSecurePassword123"
}
```
- **Response**: `201 Created`
```json
{
  "id": "7b2c9d...",
  "url": "http://localhost:3000/share/k8sX9...",
  "expires_at": "2026-11-01T14:00:00Z",
  "max_downloads": 5
}
```

### `GET /api/shares`
Lists sharing links owned by current user.

### `PATCH /api/shares/{share_id}`
Updates expiration, download limit, password, or revocation state.

### `DELETE /api/shares/{share_id}`
Revokes sharing link immediately.

---

## 6. Public Recipient Endpoints

### `GET /api/public/shares/{token}` or `GET /api/shares/{token}`
Inspects share status anonymously.
- **Response**: `200 OK`
```json
{
  "name": "Financial_Report.pdf",
  "size": 48120,
  "content_type": "application/pdf",
  "sha256_checksum": "5e884898...",
  "expires_at": "2026-11-01T14:00:00Z",
  "max_downloads": 5,
  "downloads": 1,
  "password_required": true
}
```

### `POST /api/public/shares/{token}/verify` or `POST /api/shares/{token}/verify`
Verifies sharing password against Argon2id hash and issues a temporary grant.
- **Request Body**:
```json
{
  "password": "OptionalSecurePassword123"
}
```
- **Response**: `200 OK`
```json
{
  "verified": true,
  "grant": "gr_91a0c7..."
}
```

### `POST /api/public/shares/{token}/download` or `POST /api/shares/{token}/download`
Streams decrypted file bytes. If password protected, requires `X-Share-Grant: <grant>` header.
- **Response**: `200 OK` (binary stream)

---

## 7. Audit & Telemetry Endpoints

### `GET /api/access-logs`
Retrieves global access logs for current user's files and shares.

### `GET /api/files/{file_id}/access-logs`
Retrieves access logs for a specific file.

### `GET /api/shares/{share_id}/access-logs`
Retrieves access logs for a specific share link.
