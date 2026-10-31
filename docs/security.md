# SecureShare Security Model & Threat Assessment

SecureShare enforces defense-in-depth across the web application, API, database, cryptography, and storage tiers.

---

## 1. Authentication & Session Security

- **Argon2id Hashing**: User account passwords and share-link passwords are hashed using Argon2id with memory-hard parameters resisting GPU/ASIC brute-force dictionary attacks.
- **Opaque HttpOnly Sessions**: Sessions are issued as high-entropy 32-byte cryptographically secure random values stored in `HttpOnly`, `SameSite=Lax` cookies. The server stores only the SHA-256 hash of the session token. Client-side JavaScript (`localStorage`) never has access to session tokens, preventing XSS-based session hijacking.
- **Two-Factor Authentication (TOTP)**: RFC 6238 compliant TOTP pairing using standard 6-digit codes. Emergency 8-character single-use recovery codes are stored as Argon2id hashes.
- **Session Revocation**: Password updates immediately revoke all other active sessions for that account.

---

## 2. Share Links & Access Control

- **Zero-Knowledge Token Storage**: Sharing links contain high-entropy tokens (`/share/<32-byte-urlsafe-token>`). The backend database stores only `SHA-256(token)`. A database compromise does not reveal working share links.
- **Atomic Concurrency-Safe Limits**: Download limits are decremented using atomic SQL conditional updates:
  ```sql
  UPDATE shares
  SET downloads = downloads + 1
  WHERE id = :share_id AND (max_downloads IS NULL OR downloads < max_downloads)
  ```
  This prevents concurrent HTTP requests from bypassing download limits.
- **Server-Side Expiration**: Link expiration is evaluated on every request server-side against UTC wall-clock time. Frontend timers are purely cosmetic.
- **Temporary Password Grants**: Password-protected links issue short-lived 15-minute verification grants (`X-Share-Grant`) rather than persisting verification in permanent cookies.

---

## 3. Storage Security & File Handling

- **Randomized Storage Keys**: Uploaded files are assigned random 64-character hex keys. Client-supplied filenames are never used as disk paths, completely preventing directory traversal (`../../etc/passwd`).
- **MIME & Magic Byte Validation**: Uploaded files are inspected against their declared MIME type and magic file signatures (e.g. `%PDF-` for PDFs, `\xFF\xD8\xFF` for JPEGs, `PK\x03\x04` for ZIPs), preventing executable upload masquerading.
- **Upload Size Limits**: Configurable upload limits (default 50MB) enforced before in-memory buffering.

---

## 4. Rate Limiting & Abuse Prevention

- In-memory sliding window rate limiter protects:
  - `/api/auth/login`
  - `/api/auth/register`
  - `/api/auth/login/2fa`
  - `/api/shares/{token}/verify`
- Repeated password guessing on protected share links is throttled, mitigating brute-force attacks.

---

## 5. Security Boundary & Threat Model

- **Server-Side Envelope Encryption**: SecureShare uses server-managed envelope encryption. The API gateway holds the KEK in memory and decrypts files to stream them to authenticated recipients. It is designed to secure data-at-rest against storage compromise, unprivileged database access, and rogue disk inspection.
- **No Third-Party AI / LLM Processing**: No user documents or metadata are sent to artificial intelligence models, third-party analytics, or external indexing engines.
