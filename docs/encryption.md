# SecureShare Cryptography & Encryption Specification

SecureShare implements authenticated envelope encryption based on NIST SP 800-38D (Galois/Counter Mode) and RFC 5116 (Authenticated Encryption with Associated Data).

---

## 1. Cryptographic Primitives

| Component | Standard / Specification | Key / Nonce Size |
|---|---|---|
| File Cipher | AES-GCM (Authenticated Encryption) | 256-bit Key / 96-bit Nonce |
| Key Wrapping | AES-GCM Key Encryption Key (KEK) | 256-bit Key / 96-bit Nonce |
| Password Hashing | Argon2id (RFC 9106) | Memory-hard (m=64MB, t=3, p=4) |
| Checksums | SHA-256 (FIPS 180-4) | 256-bit digest |
| Nonces & Randomness | CSPRNG (`secrets.token_bytes`) | Cryptographically secure |

---

## 2. Envelope Encryption Architecture

Directly using a single static key to encrypt multiple files causes nonce reuse risks and key exhaustion. SecureShare implements envelope encryption:

```
[Plaintext File]
       │
       ▼
 1. Generate random 256-bit Data Encryption Key (DEK)
 2. Generate unique 96-bit Nonce (IV)
 3. AES-256-GCM Encrypt with AAD="secureshare:file:v1"
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
 [Ciphertext + Auth Tag]             [Raw DEK]
       │                                 │
       ▼                                 ▼
 Stored in Object Storage       Wrap under 256-bit KEK
 (Local / S3 / MinIO)           using AES-256-GCM
                                         │
                                         ▼
                               [Wrapped DEK Envelope]
                                         │
                                         ▼
                                Stored in Database
```

### Encryption Algorithm Workflow (`backend/app/encryption.py`)
```python
def encrypt_file(plain: bytes) -> tuple[bytes, bytes, bytes]:
    data_key = secrets.token_bytes(32)    # 256-bit random DEK
    nonce = secrets.token_bytes(12)       # 96-bit unique IV
    wrap_nonce = secrets.token_bytes(12)  # 96-bit wrap IV

    # Authenticated Encryption of File
    ciphertext = AESGCM(data_key).encrypt(nonce, plain, b"secureshare:file:v1")

    # Key Wrapping under KEK
    wrapped = AESGCM(_kek()).encrypt(wrap_nonce, data_key, b"secureshare:key:v1")

    return ciphertext, nonce, wrap_nonce + wrapped
```

### Decryption Algorithm Workflow
```python
def decrypt_file(ciphertext: bytes, nonce: bytes, wrapped: bytes) -> bytes:
    # 1. Unwrap DEK using KEK
    key = AESGCM(_kek()).decrypt(wrapped[:12], wrapped[12:], b"secureshare:key:v1")
    
    # 2. Decrypt file and verify 128-bit authentication tag
    return AESGCM(key).decrypt(nonce, ciphertext, b"secureshare:file:v1")
```

---

## 3. Cryptographic Guarantees & Verification

1. **Confidentiality**: Even with physical access to the storage disks or database, files cannot be decrypted without the deployment's secret KEK (`KEK_BASE64`).
2. **Authenticity & Integrity**: AES-GCM's 128-bit authentication tag guarantees that if even a single bit of the ciphertext or nonce is modified, decryption immediately fails with `cryptography.exceptions.InvalidTag`.
3. **Nonce Uniqueness**: Nonces are generated from OS cryptographically secure random sources (`/dev/urandom` via Python `secrets`). A fresh nonce is generated for every single upload.
4. **Key Isolation**: Raw Data Encryption Keys (DEKs) exist strictly in transient RAM during the lifecycle of the upload or download request and are never written to disk or logs.
5. **Additional Associated Data (AAD)**: Domain separation strings (`secureshare:file:v1` and `secureshare:key:v1`) ensure encrypted payloads cannot be cross-substituted in other contexts.
