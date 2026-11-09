import { defineConfig, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

const webPort = Number(process.env.E2E_WEB_PORT || 3100);
const apiPort = Number(process.env.E2E_API_PORT || 8100);
const mailPort = Number(process.env.E2E_MAIL_PORT || 8123);
const smtpPort = Number(process.env.E2E_SMTP_PORT || 8124);
const baseURL = `http://127.0.0.1:${webPort}`;
const runDirectory = path.join(__dirname, '.e2e', randomUUID());
mkdirSync(runDirectory, { recursive: true });
const python = process.env.BACKEND_PYTHON || 'python';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node e2e/mailbox.cjs',
      url: `http://127.0.0.1:${mailPort}`,
      reuseExistingServer: false,
      env: { MAILBOX_PORT: String(mailPort), SMTP_PORT: String(smtpPort) },
    },
    {
      command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: path.join(__dirname, '..', 'backend'),
      url: `http://127.0.0.1:${apiPort}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATABASE_URL: `sqlite:///${path.join(runDirectory, 'database.sqlite3').replace(/\\/g, '/')}`,
        STORAGE_BACKEND: 'local',
        STORAGE_PATH: path.join(runDirectory, 'storage'),
        KEK_BASE64: randomBytes(32).toString('base64'),
        APP_SECRET: randomBytes(32).toString('hex'),
        FRONTEND_ORIGIN: baseURL,
        PUBLIC_APP_URL: baseURL,
        COOKIE_SECURE: 'false',
        COOKIE_SAMESITE: 'lax',
        MAINTENANCE_INTERVAL_SECONDS: '0',
        RUN_MIGRATIONS_ON_START: 'true',
        DEMO_LOGIN_ENABLED: 'true',
        MAIL_MODE: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: String(smtpPort),
        SMTP_USE_TLS: 'false',
        SMTP_USER: '',
        SMTP_PASSWORD: '',
        PYTHONUNBUFFERED: '1',
      },
    },
    {
      command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${webPort}`,
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { BACKEND_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
