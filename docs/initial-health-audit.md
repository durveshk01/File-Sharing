# Initial project health audit

Audit date: 2026-11-09. GitHub baseline: `264d1ec`; supplied checkout: `0a15661` plus existing frontend edits. The seven newer upstream commits were fast-forwarded after preserving local edits in `stash@{0}`. Local edits were reapplied and merge conflicts were reconciled with the newer client-encryption design.

## Product and architecture

SecureShare serves people transferring private documents and managing revocable links. It contains a Next.js 16 / React 19 browser client, Python 3.12 / FastAPI API, SQLAlchemy / Alembic database layer (SQLite or PostgreSQL), local/S3 encrypted object storage, and React Native / Expo 52 Android client. New uploads use device-side AES-256-GCM (v2); older upload APIs still use server-side envelope encryption (v1). Authentication uses hashed opaque sessions, HttpOnly cookies or native Bearer tokens, Argon2id, email verification, and TOTP. Hosting is Vercel + Render. An existing Android v1.0.0 release is published.

## Verified baseline

- `py -3.12 -m pytest -q backend/tests`: **33 passed**, 71 deprecation warnings.
- `npm audit --omit=dev --json` in `frontend`: **0 reported vulnerabilities**.
- `npm ci` in `mobile`: succeeds; audit reports **22 vulnerabilities** (1 critical, 5 high, 15 moderate, 1 low).
- Vercel production landing page opens at <https://frontend-five-fawn-27.vercel.app>.
- Render health request returns **HTTP 503** at <https://secureshare-api-9ox7.onrender.com/health>.
- GitHub authentication and Vercel CLI authentication are available. Latest recorded Render deployment succeeded on 2026-11-07; that historical result does not establish present availability.
- Android SDK is installed. `adb devices -l` reports **no devices**; no emulator is currently installed.
- Docker CLI is installed but its daemon is unavailable.
- Existing release APK is 72,296,052 bytes and its GitHub-reported SHA-256 is `959d75f2bce9fd5f748f9f1f8757f89809dbaafac20fdce4a30daa027916fd4a`. Installation and runtime behavior have not been verified.

## Critical findings

1. **Object authorization:** local raw GET is unauthenticated; raw PUT checks login but not object ownership or upload state. Another account can overwrite an object. Raw GET also bypasses password/share quotas.
2. **Demo isolation:** `/api/auth/demo` signs everyone into a single shared account, exposing previous visitors' files and permitting modification.
3. **2FA bypass:** `/api/auth/2fa/setup` resets and disables already-enabled TOTP without an authentication code.
4. **Android interoperability:** binary SHA-256 is computed over the Base64 string, not the bytes. Cross-client integrity verification fails. Module-level `TextEncoder` usage needs native-runtime verification.
5. **Deployment durability:** free Render uses ephemeral local object storage alongside persistent database metadata. Redeploying can leave irrecoverable file records. API is currently unavailable.

## High priority

- Release APK defaults to emulator HTTP address and release signing uses the committed public debug keystore.
- Cookie requests lack explicit CSRF origin enforcement; credentialed CORS trusts every `vercel.app` site.
- Bearer logout/password-change paths do not revoke the intended sessions; device revocation does not invalidate sessions.
- Upload intents accept invalid nonce lengths/versions/hashes, create visible records before transfer, and confirmation does not verify stored size/hash. No account quota is enforced.
- Resumable chunks have no size limit and are temporarily stored plaintext; abort can remove another user's chunks and path construction accepts unchecked IDs.
- Copy references a unique object key, causing an integrity error. Deleting shared storage would also break clones.
- Legacy detail/download/verification screens do not support new v2 files correctly. Missing local keys can produce unusable share links.
- Trash has no usable browser management flow; collaborator files cannot be discovered; EDITOR has no editing workflow.
- Offline mobile records omit nonces, duplicate filenames overwrite vault objects, failed queues never retry, sync overwrites offline paths, and offline opening always requests the server.
- Mobile authentication does not implement the TOTP challenge; API override is not persisted, and local data is not account-scoped.
- Mobile dependency audit reports high/critical issues requiring dependency-by-dependency remediation.

## Medium priority

- Invalid sync payloads can cause HTTP 500; stale-version updates are not atomically conditional. Delta cursor can skip concurrent changes and is unpaginated.
- Global process-wide download lock serializes unrelated file transfers. Several endpoints load entire collections and dashboards sum data in Python.
- Audit rows cascade away on file deletion; denied/nonexistent-file logging conflicts with enforced foreign keys.
- Migration startup logs failures and proceeds with `create_all`; readiness reports healthy without querying the database.
- TOTP secrets are stored plaintext; development KEK is hardcoded. Email token bodies are retained indefinitely and printed to logs.
- Share password changes do not invalidate previously issued grants; quota can be consumed before a failed transfer.
- Range parsing does not validate invalid/suffix/multiple ranges. Non-ASCII filenames can break response headers.
- Most secondary screens have duplicated navigation, insufficient error/loading feedback, and old styles removed by the newer redesign. Mobile navigation disappears below 900px.
- Placeholder-style product claims (verified tags, always-one device, direct S3, automatic background sync) are displayed without supporting state.
- CI lacks browser workflows, security regression coverage, Python linting, and release-signature/installation checks; manual release workflow can overwrite v1.0.0.

## Low priority

- Documentation contains inaccurate claims about zero-knowledge legacy uploads, chunked transfers, guaranteed hardware-backed storage, test counts, and Android minimum OS.
- README links an absent license file. Branding and TOTP issuer include older CloudVault naming.
- Deprecation warnings, inconsistent formatting, redundant browser API clients, and third-party font loading increase maintenance work.

## Category statuses

| Category | Initial status | Evidence |
| --- | --- | --- |
| Code/build | Needs improvement | Passing backend baseline; reproducible copy/validation defects identified in code |
| Frontend | Needs improvement | Available landing page; incomplete secondary/mobile flows |
| Backend/data | Critical | Object authorization, upload state, and session defects |
| Security | Critical | Object overwrite, demo isolation, 2FA bypass, mobile advisories |
| Web deployment | Critical | Live API 503 and ephemeral storage configuration |
| Android | Critical | Wrong API default, debug release signing, crypto/offline defects |
| Performance | Needs improvement | Unbounded queries, global transfer lock, duplicate buffers |
| Testing | Needs improvement | 33 backend tests; no browser/native execution evidence |

## External dependencies

Render management credentials, durable production storage credentials, SMTP delivery credentials, and a private production signing identity are not currently configured in the execution environment. No physical Android device is connected. Their absence is a delivery blocker for the corresponding verified claims; local implementation and build work can continue.
