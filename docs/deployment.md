# SecureShare Production Deployment Guide

This guide describes production deployment of SecureShare using containerization, managed PostgreSQL, and S3-compatible private object storage.

---

## 1. Environment Configuration

Generate high-entropy random secrets:
```bash
# 1. App Session Secret (32 bytes hex)
python -c "import secrets; print(secrets.token_hex(32))"

# 2. Key Encryption Key (32 bytes base64)
python -c "import base64, secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())"
```

Configure `.env`:
```env
APP_SECRET=<generated-app-secret>
KEK_BASE64=<generated-kek-base64>
DATABASE_URL=postgresql+psycopg://secureshare:prod_password@db.internal:5432/secureshare

# Production Object Storage
STORAGE_BACKEND=s3
S3_BUCKET_NAME=my-secureshare-bucket
S3_ENDPOINT_URL=https://s3.us-east-1.amazonaws.com
S3_REGION_NAME=us-east-1
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...

# Domain & Security
FRONTEND_ORIGIN=https://secureshare.yourdomain.com
PUBLIC_APP_URL=https://secureshare.yourdomain.com
COOKIE_SECURE=true
SESSION_DAYS=7
MAX_UPLOAD_BYTES=52428800
RUN_MIGRATIONS_ON_START=true
DEMO_LOGIN_ENABLED=false

# SMTP Mail Delivery
MAIL_MODE=smtp
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=...
MAIL_FROM=security@secureshare.yourdomain.com
```

---

## 2. Docker Compose Deployment

The provided `docker-compose.yml` launches PostgreSQL, MinIO, FastAPI Backend, and Next.js Frontend:

```bash
# Build and start all services in background
docker compose up -d --build

# Inspect logs
docker compose logs -f api

# Verify running services
docker compose ps
```

Services exposed:
- Frontend: `http://localhost:3000`
- API & Docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`
- MinIO Object Storage Console: `http://localhost:9001`

---

## 3. Cloud Hosting Deployments

### Backend (Render / Railway / Fly.io / AWS ECS)
1. Build context: `./backend`
2. Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`
3. Environment variables: Provide secrets, `DATABASE_URL`, and `KEK_BASE64`.
4. Health check: `/health`

### Frontend (Vercel / Cloudflare Pages / Container)
1. Build context: `./frontend`
2. Build command: `npm run build`
3. Output directory: Next.js standalone
4. Environment variables: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`

---

## 4. Key Management & Rotation

- **KEK Storage**: In production, store `KEK_BASE64` in AWS Secrets Manager, HashiCorp Vault, or Google Cloud Secret Manager.
- **Backups**: Ensure database backups (containing wrapped keys) and object storage buckets (containing ciphertext) are backed up in synchrony.
