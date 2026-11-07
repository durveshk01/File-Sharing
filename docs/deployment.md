# SecureShare Production Deployment Guide: Mobile, Render & Vercel

This comprehensive guide details the deployment architecture of the upgraded **device-powered SecureShare platform**:
- **Coordination Backend & PostgreSQL**: [Render](https://render.com) (FastAPI Lightweight Web Service + Managed PostgreSQL)
- **Web Frontend**: [Vercel](https://vercel.com) (Next.js 16 Edge / Serverless)
- **Direct Object Storage**: [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) / [AWS S3](https://aws.amazon.com/s3/) (Zero-egress private ciphertext storage)
- **Mobile Client**: [React Native / Expo](https://expo.dev) (Local-first Android APK & iOS build via EAS)

---

## 1. Architecture & Zero-Knowledge Data Flow

```
   ┌─────────────────────────────────────────────────────────────┐
   │                  Vercel (100% Free Tier)                    │
   │               Next.js 16 Frontend Hosting                  │
   │           https://secureshare-frontend.vercel.app           │
   │  • Serves Web UI & Web Crypto local AES-256-GCM engine      │
   │  • Zero-knowledge #key= client-side decryption              │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ HTTPS (Metadata & Coordination only)
   ┌──────────────────────────────▼──────────────────────────────┐
   │                  Render (100% Free Tier)                    │
   │         FastAPI Lightweight Coordination Gateway            │
   │             https://secureshare-api.onrender.com            │
   │  • Session token authentication (Bearer & Cookies)          │
   │  • Presigned URL generation for direct object storage       │
   │  • Delta sync cursor engine & device registration           │
   │  • NEVER buffers or decrypts plaintext files                │
   └──────────────┬──────────────────────────────┬───────────────┘
                  │ Internal SQL                 │ Presigned Auth
   ┌──────────────▼──────────────┐┌──────────────▼──────────────┐
   │   Render Managed PostgreSQL ││ Cloudflare R2 / AWS S3 Bucket│
   │  • File metadata & sizes    ││  • Raw AES-256-GCM ciphertext│
   │  • Sync delta cursors       ││  • Direct client transfers   │
   │  • Ciphertext SHA-256 hashes││  • Zero server RAM buffering │
   └─────────────────────────────┘└──────────────┬──────────────┘
                                                 ▲ Direct Upload / Download
                                                 │ (AES-256-GCM Ciphertext)
   ┌─────────────────────────────────────────────┴──────────────┐
   │          Native Mobile Device (Android / iOS)               │
   │  • Local AES-256-GCM & SHA-256 processing on phone          │
   │  • Hardware Keystore (Expo SecureStore)                     │
   │  • SQLite offline-first sync queue                          │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Deploying the Backend on Render

Render provisions the database and coordinates metadata.

### Method A: Blueprint Infrastructure as Code (`render.yaml`)
1. Sign in to [render.com](https://render.com).
2. Click **New +** -> **Blueprint**.
3. Select your repository (`File-Sharing`).
4. Render detects [`render.yaml`](file:///d:/Project/New%20folder/render.yaml) automatically and plans:
   - Web Service: `secureshare-api` (Python 3.12, Free)
   - PostgreSQL: `secureshare-db` (Free)
5. Click **Apply**. Render will run `pip install -r requirements.txt`, execute Alembic migrations (`python -m alembic upgrade head`), and start the API server.

### Environment Variables
| Key | Example Value | Description |
| :--- | :--- | :--- |
| `PYTHON_VERSION` | `3.12.0` | Python runtime version |
| `APP_SECRET` | `64-char hex` | Session signing key (`secrets.token_hex(32)`) |
| `KEK_BASE64` | `44-char base64` | Key Encryption Key (`base64.b64encode(secrets.token_bytes(32))`) |
| `DATABASE_URL` | *fromDatabase* | Render PostgreSQL connection string |
| `STORAGE_BACKEND` | `s3` or `local` | Set `s3` for AWS S3 / Cloudflare R2 direct transfers |
| `S3_BUCKET_NAME` | `secureshare-vault` | Object storage bucket name |
| `S3_ENDPOINT_URL` | `https://<account_id>.r2.cloudflarestorage.com` | R2 or S3 endpoint URL |
| `S3_ACCESS_KEY_ID` | `r2_access_key` | S3 API Access Key ID |
| `S3_SECRET_ACCESS_KEY` | `r2_secret_key` | S3 API Secret Key |
| `S3_REGION` | `auto` | Bucket region |
| `FRONTEND_ORIGIN` | `https://secureshare.vercel.app` | Allowed CORS origin |
| `RUN_MIGRATIONS_ON_START` | `true` | Automatically runs Alembic migrations on startup |

---

## 3. Deploying the Web Frontend on Vercel

1. Sign in to [vercel.com](https://vercel.com) with GitHub.
2. Click **Add New...** -> **Project** and select `File-Sharing`.
3. Set **Root Directory** to `frontend`.
4. Configure Environment Variables:
   - `NEXT_PUBLIC_API_URL`: Your Render backend URL (e.g. `https://secureshare-api.onrender.com`)
   - `BACKEND_URL`: Same Render backend URL (for Next.js rewrite proxy)
5. Click **Deploy**. Vercel will build the standalone Next.js 16 application with Turbopack.

---

## 4. Mobile Client: Local Development & Android APK Build

The mobile client is built on **React Native & Expo SDK 52** with native SQLite and hardware security.

### A. Run Locally on Android Device / Emulator
```bash
cd mobile

# 1. Install dependencies
npm install

# 2. Configure API endpoint in src/services/api.ts or via environment:
# EXPO_PUBLIC_API_URL=https://secureshare-api.onrender.com

# 3. Start Expo development server
npx expo start
```
- Press `a` in the terminal to launch on a connected Android device via ADB.
- Scan the QR code with the **Expo Go** app for immediate testing.

### B. Build Standalone Android APK (EAS Build)
You can compile a production `.apk` file for side-loading or release using Expo Application Services (EAS):

1. **Install EAS CLI**:
   ```bash
   npm install -g eas-cli
   ```
2. **Log in to Expo**:
   ```bash
   eas login
   ```
3. **Configure Build Project** (already pre-configured in `mobile/eas.json`):
   ```bash
   cd mobile
   eas build:configure
   ```
4. **Build APK via EAS Cloud** (Generates standalone APK installable on any Android phone):
   ```bash
   eas build --platform android --profile preview
   ```
   *EAS will build the APK in the cloud and provide a direct download link (e.g. `https://expo.dev/artifacts/eas/...apk`).*

5. **Local APK Build** (Using your local Android SDK and Gradle):
   ```bash
   eas build --platform android --profile preview --local
   ```
   The compiled `.apk` will be output to your local directory.

---

## 5. End-to-End Operational Verification Checklist

| Test Item | Verification Procedure | Expected Outcome |
| :--- | :--- | :--- |
| **Backend Health** | `GET https://<api-url>/health` | Status 200, `"status": "healthy"`, DB connected |
| **Device Registration** | Mobile app logs in | Mobile device recorded in `devices` table with UUID |
| **Client-Side Encryption** | Upload 10 MB PDF from mobile/web | Zero plaintext touches backend; object stored is encrypted ciphertext |
| **Ciphertext Tamper Check** | Modify 1 byte of remote ciphertext | Decryption fails immediately with `InvalidTag` on phone/browser |
| **Zero-Knowledge Link** | Open `/share/<token>#key=<key>` in incognito | Key read from URL fragment; downloaded ciphertext decrypted locally in browser |
| **Offline Sync Queue** | Pick file on phone in airplane mode | Queued in local SQLite; automatically uploads when Wi-Fi reconnects |
