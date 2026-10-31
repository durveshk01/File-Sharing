# SecureShare Local Development Setup

Follow these steps to run SecureShare locally with zero paid dependencies and instant hot-reloading.

---

## Prerequisites
- Python 3.12+
- Node.js 20+
- npm or pnpm

---

## Step 1: Environment Setup
Copy the environment template and generate local secrets:
```bash
cp .env.example .env
```
Ensure `DATABASE_URL=sqlite:///./data/secureshare.db` and `STORAGE_BACKEND=local` are set for zero-configuration SQLite & local disk operation.

---

## Step 2: Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt pytest

# Run database migrations
python -m alembic upgrade head

# Start FastAPI development server
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
Interactive OpenAPI documentation will be available at: `http://127.0.0.1:8000/docs`

---

## Step 3: Frontend Setup
In a new terminal:
```bash
cd frontend
npm install
npm run dev
```
Open your browser to: `http://localhost:3000`

---

## Step 4: One-Click Demo Mode
On `http://localhost:3000`, click **"Live Demo"** in the top navigation or **"Try Live Demo (No Signup)"** on the landing page to enter the workspace instantly without needing to register or configure an SMTP server.

---

## Step 5: Running Automated Tests
```bash
pytest backend/tests
```
All 28 automated security, cryptographic, concurrency, and access control tests will execute.
