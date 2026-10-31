# SecureShare 100% Free Production Deployment Guide (Render + Vercel)

This guide walks you through deploying the complete SecureShare platform **100% free of cost** using:
- **Backend & Database**: [Render](https://render.com) (FastAPI Web Service + Free PostgreSQL)
- **Frontend**: [Vercel](https://vercel.com) (Next.js 16 Edge / Serverless)

---

## 1. Architecture & Live Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │                  Vercel (100% Free Tier)                    │
   │               Next.js 16 Frontend Hosting                  │
   │           https://secureshare-frontend.vercel.app           │
   │                                                             │
   │  • Serves UI / Static Assets / SSR                          │
   │  • Optional rewrite proxy (/api/:path* -> Render)          │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ HTTPS / Cookies
   ┌──────────────────────────────▼──────────────────────────────┐
   │                  Render (100% Free Tier)                    │
   │             FastAPI Web Service & Encryption Engine         │
   │             https://secureshare-api.onrender.com            │
   │                                                             │
   │  • Python 3.12 Runtime                                      │
   │  • AES-256-GCM Envelope Encryption                          │
   │  • Argon2id Password Hashing & TOTP 2FA                     │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ Internal Connection
   ┌──────────────────────────────▼──────────────────────────────┐
   │           Render Free PostgreSQL (or Neon / Supabase)       │
   │  • 1 GB Free Persistent SQL Storage                         │
   │  • Automated Schema Migrations (Alembic)                    │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Step 1: Push Code to GitHub

Ensure all files and deployment configurations are pushed to your GitHub repository:
```bash
git add .
git commit -m "feat: prepare production deployment for Render and Vercel"
git push origin main
```
*Repository link example:* `https://github.com/durveshk01/File-Sharing`

---

## 3. Step 2: Deploy Backend & Database on Render (Free)

Render offers free web services and free PostgreSQL databases. You can deploy using either the **1-Click Blueprint** or **Manual Setup**.

### Method A: 1-Click Infrastructure as Code (Blueprint) — Recommended
1. Sign in or register at [render.com](https://render.com).
2. Click the **"New +"** button at the top right and select **"Blueprint"**.
3. Connect your GitHub repository (`File-Sharing`).
4. Render will automatically detect [`render.yaml`](file:///d:/Project/New%20folder/render.yaml) at the repository root.
5. Render displays:
   - Web Service: `secureshare-api` (Python, Free plan)
   - PostgreSQL Database: `secureshare-db` (Free plan)
6. Click **"Apply"**.
7. Render provisions the database, builds dependencies (`pip install -r requirements.txt`), runs database migrations, and launches Uvicorn on `$PORT`.

### Method B: Manual Service Creation
If you prefer configuring through the Render UI manually:
1. **Create Free Database**:
   - Go to **New +** -> **PostgreSQL**.
   - Name: `secureshare-db`
   - Database: `secureshare`
   - User: `secureshare_user`
   - Plan: **Free**
   - Click **Create Database**. Copy the **Internal Database URL** (e.g. `postgres://...`).
2. **Create Web Service**:
   - Go to **New +** -> **Web Service**.
   - Connect your GitHub repository.
   - Root Directory: `backend`
   - Environment: `Python 3`
   - Region: Same region as your database (e.g. `Oregon`)
   - Branch: `main`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Plan: **Free**
3. **Set Environment Variables on Render**:
   In the service **Environment** tab, add:
   | Key | Value | Description |
   | :--- | :--- | :--- |
   | `PYTHON_VERSION` | `3.12.0` | Python runtime version |
   | `APP_SECRET` | *32-byte hex string* | e.g. `python -c "import secrets; print(secrets.token_hex(32))"` |
   | `KEK_BASE64` | *32-byte base64 string* | e.g. `python -c "import secrets, base64; print(base64.b64encode(secrets.token_bytes(32)).decode())"` |
   | `DATABASE_URL` | *Your Render Internal Database URL* | Render PostgreSQL URL (auto-normalized to `postgresql+psycopg://`) |
   | `STORAGE_BACKEND` | `local` | Uses local container storage (or `s3` with free AWS S3/Cloudflare R2/Supabase) |
   | `STORAGE_PATH` | `./storage` | Directory for encrypted ciphertexts |
   | `FRONTEND_ORIGIN` | `https://your-frontend.vercel.app` | Your Vercel frontend URL (comma-separated or vercel.app regex allowed) |
   | `COOKIE_SECURE` | `true` | Enforces HTTPS cookies |
   | `COOKIE_SAMESITE` | `none` | Allows cross-origin session cookies between Vercel and Render |
   | `RUN_MIGRATIONS_ON_START` | `true` | Executes Alembic schema migrations upon container start |
   | `DEMO_LOGIN_ENABLED` | `true` | Enables 1-click live demo login for portfolio reviewers |

4. **Verify Backend Deployment**:
   Open `https://<your-service-name>.onrender.com/` in your browser. You should receive:
   ```json
   {
     "service": "SecureShare API",
     "status": "online",
     "version": "1.0.0",
     "docs": "/docs",
     "health": "/health"
   }
   ```
   Open `https://<your-service-name>.onrender.com/docs` to see the live interactive OpenAPI Swagger docs.

---

## 4. Step 3: Deploy Frontend on Vercel (Free)

Vercel natively optimizes Next.js 16 with zero configuration.

1. Sign in or register at [vercel.com](https://vercel.com) using your GitHub account.
2. Click **"Add New..."** -> **"Project"**.
3. Under "Import Git Repository", select `File-Sharing`.
4. In the **Configure Project** screen:
   - **Project Name**: `secureshare` (or your choice)
   - **Framework Preset**: `Next.js` (detected automatically)
   - **Root Directory**: Click "Edit" and select `frontend`.
5. In **Environment Variables**, add:
   | Key | Value | Notes |
   | :--- | :--- | :--- |
   | `NEXT_PUBLIC_API_URL` | `https://<your-service-name>.onrender.com` | Your live Render backend URL |
   | `BACKEND_URL` | `https://<your-service-name>.onrender.com` | Enables Next.js backend proxy rewrites |
6. Click **"Deploy"**.
7. Vercel will install dependencies, build pages with Turbopack, and assign you a live HTTPS domain:
   `https://secureshare-<your-username>.vercel.app`

---

## 5. Step 4: Link Frontend & Backend URLs

Once both services are deployed:
1. Copy your live Vercel URL (e.g. `https://secureshare-durvesh.vercel.app`).
2. Go back to your Render Dashboard -> `secureshare-api` -> **Environment**.
3. Update `FRONTEND_ORIGIN` to your exact Vercel URL:
   ```
   FRONTEND_ORIGIN=https://secureshare-durvesh.vercel.app
   ```
4. Render will automatically redeploy the backend with the updated CORS origin.

---

## 6. Step 5: Verification & End-to-End Walkthrough

1. **Visit Landing Page**:
   Open your live Vercel URL in your browser.
2. **Instant Demo Login**:
   Click the **"Live Demo Login"** button on the landing page or login screen.
3. **Upload an Encrypted File**:
   Drag and drop any file (PDF, PNG, ZIP, TXT) into the upload dropzone. Watch the client upload, AES-256-GCM cipher encryption, and DEK wrapping take place.
4. **Inspect Cryptographic Metadata**:
   Click on the uploaded file to view the 96-bit nonce, 128-bit authentication tag, and wrapped key hex.
5. **Generate a Secure Share Link**:
   Create a link with a 24-hour expiration, a 3-download limit, and an optional recipient password.
6. **Open in Incognito**:
   Paste the sharing link into a private window. Enter the password (if set), verify the integrity badge, and download the decrypted file.
7. **Audit Telemetry**:
   Return to your dashboard and inspect `/access-logs` to see the verified download event, IP address, and timestamp.

---

## 7. Permanent Free Cloud Database Alternatives

Render's free PostgreSQL tier offers 1 GB storage and suspends after 30 days of inactivity on unmaintained accounts. If you want a **permanent free database that never expires**, you can plug in any of these free PostgreSQL providers:

| Provider | Free Tier Details | Compatibility |
| :--- | :--- | :--- |
| **[Neon.tech](https://neon.tech)** | 0.5 GB storage, serverless Postgres, instant setup, never expires | 100% compatible with `postgresql+psycopg://` |
| **[Supabase](https://supabase.com)** | 500 MB Postgres database, connection pooling, free tier | 100% compatible |
| **[Aiven](https://aiven.io)** | 5 GB free trial Postgres | 100% compatible |

To use Neon or Supabase:
1. Create a free project on Neon or Supabase.
2. Copy the PostgreSQL connection string.
3. Paste it into the `DATABASE_URL` environment variable on Render.
4. Redeploy — Alembic will run migrations and initialize all tables automatically!
