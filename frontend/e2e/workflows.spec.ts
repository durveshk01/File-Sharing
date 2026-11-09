import { test, expect, type Page, type Download, type APIRequestContext } from '@playwright/test';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const password = 'Browser-test-password-2026!';
const mailURL = `http://127.0.0.1:${process.env.E2E_MAIL_PORT || 8123}`;
const binary = Buffer.from(Array.from({ length: 32_768 }, (_, i) => (i * 37) % 256));
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function demo(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Instant Demo Sign-in/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const account = await (await page.request.get('/api/auth/me')).json();
  await page.goto('/files');
  return account as { id: string; email: string };
}

async function upload(page: Page, name = 'private-世界.bin') {
  const intentResponse = page.waitForResponse((response) => response.url().endsWith('/api/storage/upload-intent') && response.request().method() === 'POST');
  const confirmed = page.waitForResponse((response) => response.url().endsWith('/confirm-upload') && response.request().method() === 'POST');
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/octet-stream', buffer: binary });
  const intent = await (await intentResponse).json();
  expect((await confirmed).ok()).toBeTruthy();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  return intent.file_id as string;
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}

async function mailLink(request: APIRequestContext, email: string, page: string) {
  const messages: { body: string }[] = await (await request.get(`${mailURL}/messages?to=${encodeURIComponent(email)}`)).json();
  const message = messages.findLast((mail) => mail.body.includes(`/${page}?token=`));
  expect(message, `A real SMTP ${page} message must be delivered`).toBeDefined();
  return message!.body.match(new RegExp(`http://[^\\s<>]+/${page}\\?token=[A-Za-z0-9_-]+`))![0];
}

async function login(page: Page, email: string, pass = password) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(pass);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret].map((letter) => alphabet.indexOf(letter).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

test('registration, one-time email verification, 2FA recovery, and password reset use real cookie sessions', async ({ page, request }) => {
  const email = `browser-${randomUUID()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Browser Workflow');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  const verification = await mailLink(request, email, 'verify');
  await page.goto(verification);
  await expect(page).toHaveURL(/\/dashboard$/);
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === 'secureshare_session')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('secureshare_token'))).toBeNull();
  expect((await page.request.post('/api/auth/verify-email', { data: { token: new URL(verification).searchParams.get('token') } })).status()).toBe(400);

  await page.goto('/security');
  const setupResponse = page.waitForResponse((response) => response.url().endsWith('/api/auth/2fa/setup'));
  await page.getByRole('button', { name: 'Set up Two-Factor Authentication' }).click();
  const setup = await (await setupResponse).json();
  await page.getByLabel('Step 3: Enter 6-Digit Code from Authenticator').fill(totp(setup.secret));
  await page.getByRole('button', { name: 'Activate 2FA Protection' }).click();
  await expect(page.getByText('2FA Active', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Two-factor challenge' })).toBeVisible();
  await page.getByLabel('Authentication or recovery code').fill(setup.recovery_codes[0]);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/security');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke All Sessions' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email);
  await page.getByLabel('Authentication or recovery code').fill(setup.recovery_codes[0]);
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page.locator('.auth-error[role=alert]')).toBeVisible();
  await page.getByLabel('Authentication or recovery code').fill(totp(setup.secret));
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/forgot-password');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send instructions' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  await page.goto(await mailLink(request, email, 'reset-password'));
  const changedPassword = 'Changed-browser-password-2026!';
  await page.getByLabel('New password', { exact: true }).fill(changedPassword);
  await page.getByRole('button', { name: 'Reset password', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
  await login(page, email, changedPassword);
  await page.getByLabel('Authentication or recovery code').fill(totp(setup.secret));
  await page.getByRole('button', { name: 'Verify & Continue' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('binary v2 upload sends ciphertext only and download uses the scoped grant with exact integrity', async ({ page }) => {
  const account = await demo(page);
  const requests: { url: string; method: string; headers: Record<string, string>; body: string | null }[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) requests.push({ url: request.url(), method: request.method(), headers: request.headers(), body: request.postData() }); });
  const id = await upload(page);
  const metadata = await (await page.request.get(`/api/files/${id}`)).json();
  expect(metadata.sha256_checksum).toBe(sha256(binary));
  expect(metadata.encryption_version).toBe('v2');
  expect(metadata.ciphertext_sha256).not.toBe(metadata.sha256_checksum);
  const key = await page.evaluate(({ account, id }) => JSON.parse(localStorage.getItem(`secureshare_file_keys:${account}`)!)[id], { account: account.id, id });
  const download = page.waitForEvent('download');
  const downloadAuthorization = page.waitForResponse((response) => response.url().endsWith(`/api/files/${id}/download-intent`));
  await page.getByRole('row').filter({ hasText: 'private-世界.bin' }).getByTitle('Download & Decrypt Locally', { exact: true }).click();
  expect(await downloadBytes(await download)).toEqual(binary);
  const authorized = await (await downloadAuthorization).json();
  expect(requests.some((request) => request.url.endsWith(authorized.download_url) && request.method === authorized.download_method && request.headers['x-storage-grant'] === authorized.download_headers['X-Storage-Grant'])).toBe(true);
  expect(requests.some((request) => request.headers.authorization || request.url.includes(key) || request.body?.includes(key))).toBe(false);
});

test('copy inherits the key, trash restores, legacy keys are backed up, and source deletion keeps the copy readable', async ({ page }) => {
  const account = await demo(page);
  const id = await upload(page, 'original.bin');
  const row = page.getByRole('row').filter({ hasText: 'original.bin' });
  const copiedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/files/${id}/copy`));
  await row.getByTitle('Duplicate / Copy', { exact: true }).click();
  const copy = await (await copiedResponse).json();
  await expect(page.getByRole('link', { name: copy.name, exact: true })).toBeVisible();
  await page.evaluate(({ account, id }) => {
    const slot = `secureshare_file_keys:${account}`;
    const keys = JSON.parse(localStorage.getItem(slot)!);
    localStorage.setItem('secureshare_file_keys', JSON.stringify({ [id]: keys[id] }));
    delete keys[id]; localStorage.setItem(slot, JSON.stringify(keys));
  }, { account: account.id, id });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row').filter({ has: page.getByRole('link', { name: 'original.bin', exact: true }) }).getByTitle('Move to Trash', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'original.bin', exact: true })).toHaveCount(0);
  await page.goto('/settings');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export private keys' }).click();
  const backup = await downloadBytes(await exported);
  const parsed = JSON.parse(backup.toString());
  expect(parsed.account_id).toBe(account.id);
  expect(parsed.keys[id]).toBe(parsed.keys[copy.id]);
  await page.evaluate(({ account, id }) => {
    const slot = `secureshare_file_keys:${account}`;
    const keys = JSON.parse(localStorage.getItem(slot)!); delete keys[id]; localStorage.setItem(slot, JSON.stringify(keys));
  }, { account: account.id, id: copy.id });
  await page.locator('input[type=file]').setInputFiles({ name: 'keys.json', mimeType: 'application/json', buffer: backup });
  await expect(page.getByRole('status')).toContainText('Restored 2 file keys');
  await page.goto('/files/manage');
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Restored "original.bin"');
  await page.goto(`/files/${id}`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Move to trash' }).click();
  await page.goto('/files/manage');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Permanently delete' }).click();
  await expect(page.getByText('No files in this collection.')).toBeVisible();
  await page.goto(`/files/${copy.id}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Decrypted' }).click();
  expect(await downloadBytes(await download)).toEqual(binary);
});

test('password share keys stay in the fragment; wrong passwords recover and exhausted/revoked links are denied', async ({ page, browser }) => {
  await demo(page);
  const id = await upload(page, 'shared.bin');
  await page.getByRole('row').filter({ hasText: 'shared.bin' }).getByTitle('Share Link', { exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Maximum Allowed Downloads').selectOption('1');
  await modal.getByLabel('Share access password').fill('Share-password!');
  await modal.getByRole('button', { name: 'Create Secure Share Link' }).click();
  const input = modal.getByLabel('Generated share URL');
  await expect(input).toHaveValue(/#key=/);
  const link = await input.inputValue();
  const key = new URLSearchParams(new URL(link).hash.slice(1)).get('key')!;
  const recipient = await browser.newContext();
  const publicPage = await recipient.newPage();
  const transmitted: string[] = [];
  publicPage.on('request', (request) => transmitted.push(`${request.url()} ${request.postData() || ''}`));
  await publicPage.goto(link);
  await publicPage.getByPlaceholder('Enter the share access password...').fill('Incorrect-password!');
  await publicPage.getByRole('button', { name: 'Unlock File' }).click();
  await expect(publicPage.locator('.notice-error[role=alert]')).toBeVisible();
  await publicPage.getByPlaceholder('Enter the share access password...').fill('Share-password!');
  await publicPage.getByRole('button', { name: 'Unlock File' }).click();
  const download = publicPage.waitForEvent('download');
  await publicPage.getByRole('button', { name: 'Decrypt & Download File' }).click();
  expect(await downloadBytes(await download)).toEqual(binary);
  expect(transmitted.some((request) => request.includes(key) || request.includes(encodeURIComponent(key)))).toBe(false);
  await publicPage.reload();
  await expect(publicPage.getByRole('heading', { name: 'Access Unavailable' })).toBeVisible();
  const another = await (await page.request.post(`/api/files/${id}/shares`, { data: { max_downloads: 5 } })).json();
  await page.goto('/shared');
  const revoked = page.waitForResponse((response) => response.url().endsWith(`/api/shares/${another.id}`) && response.request().method() === 'DELETE');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('row').filter({ hasText: another.id.slice(0, 8) }).getByTitle('Revoke Share Link', { exact: true }).click();
  expect((await revoked).ok()).toBeTruthy();
  await publicPage.goto(`${another.url}#key=${encodeURIComponent(key)}`);
  await expect(publicPage.getByRole('heading', { name: 'Access Unavailable' })).toBeVisible();
  await recipient.close();
});

test('collaborators discover files, import authenticated keys, rename as EDITOR, and lose access on revocation', async ({ page, browser }) => {
  const owner = await demo(page);
  const id = await upload(page, 'collaborator.bin');
  const key = await page.evaluate(({ account, id }) => JSON.parse(localStorage.getItem(`secureshare_file_keys:${account}`)!)[id], { account: owner.id, id });
  const reader = await browser.newContext();
  const readerPage = await reader.newPage();
  const colleague = await demo(readerPage);
  await page.goto(`/files/${id}`);
  await page.getByLabel('Grant Access to Email').fill(colleague.email);
  await page.getByLabel('Permission Level').selectOption('EDITOR');
  const permissionResponse = page.waitForResponse((response) => response.url().endsWith(`/api/files/${id}/permissions`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add Collaborator' }).click();
  const permissionResult = await permissionResponse;
  expect(permissionResult.ok()).toBeTruthy();
  const permission = await permissionResult.json();
  await readerPage.goto('/files/manage?view=shared');
  await expect(readerPage.getByText('collaborator.bin', { exact: true })).toBeVisible();
  await readerPage.getByRole('link', { name: 'Open details & key import' }).click();
  await expect(readerPage.getByText(/Your permission is EDITOR/)).toBeVisible();
  await readerPage.getByLabel('Base64 file decryption key').fill(randomBytes(32).toString('base64'));
  await readerPage.getByRole('button', { name: 'Verify & import key' }).click();
  await expect(readerPage.locator('.auth-error[role=alert]')).toContainText('Decryption could not authenticate the file. The private key is incorrect or the encrypted file was changed.');
  expect(await readerPage.evaluate(({ account, id }) => JSON.parse(localStorage.getItem(`secureshare_file_keys:${account}`) || '{}')[id] || null, { account: colleague.id, id })).toBeNull();
  await readerPage.getByLabel('Base64 file decryption key').fill(key);
  await readerPage.getByRole('button', { name: 'Verify & import key' }).click();
  await expect(readerPage.getByRole('status')).toContainText('Private key imported');
  await readerPage.getByLabel('New file name').fill('renamed-by-editor.bin');
  await readerPage.getByRole('button', { name: 'Save name' }).click();
  await expect(readerPage.getByRole('heading', { name: 'renamed-by-editor.bin' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(page.getByText(colleague.email, { exact: true })).toHaveCount(0);
  expect([403, 404]).toContain((await readerPage.request.get(`/api/files/${id}`)).status());
  expect(permission.id).toBeTruthy();
  await reader.close();
});

test('tampered ciphertext is rejected before a download is saved and unfinished uploads can be cancelled', async ({ page }) => {
  await demo(page);
  const id = await upload(page, 'integrity.bin');
  await page.goto(`/files/${id}`);
  await page.route('**/api/storage/raw/**', async (route) => {
    const response = await route.fetch();
    const bytes = await response.body(); bytes[0] ^= 1;
    await route.fulfill({ response, body: bytes });
  });
  let saved = false;
  page.on('download', () => { saved = true; });
  await page.getByRole('button', { name: 'Download Decrypted' }).click();
  await expect(page.locator('.auth-error[role=alert]')).toContainText(/checksum/i);
  expect(saved).toBe(false);
  await page.unroute('**/api/storage/raw/**');
  const pending = await (await page.request.post('/api/storage/upload-intent', { data: {
    name: 'cancel-me.bin', size: 32, ciphertext_size: 48, content_type: 'application/octet-stream',
    sha256_checksum: '0'.repeat(64), ciphertext_sha256: '1'.repeat(64), nonce_b64: randomBytes(12).toString('base64'), wrapped_key_b64: '', encryption_version: 'v2',
  } })).json();
  await page.goto('/files/manage?view=pending');
  await expect(page.getByText('cancel-me.bin', { exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(page.getByText('No files in this collection.')).toBeVisible();
  expect((await page.request.get('/api/files/pending')).ok()).toBeTruthy();
  expect((await page.request.get(`/api/files/${pending.file_id}`)).status()).toBe(404);
  expect((await (await page.request.get('/api/storage/usage')).json()).pending_bytes).toBe(0);
});

test('legacy v1 downloads use the returned decrypted endpoint without requiring a device key', async ({ page }) => {
  await demo(page);
  const response = await page.request.post('/api/files', { multipart: { file: { name: 'legacy.bin', mimeType: 'application/octet-stream', buffer: binary } } });
  expect(response.ok()).toBeTruthy();
  const file = await response.json();
  await page.goto(`/files/${file.id}`);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Decrypted' }).click();
  expect(await downloadBytes(await download)).toEqual(binary);
});

test('small-screen workspace navigation, keyboard skip link, device revocation and long metadata stay usable', async ({ page }, info) => {
  await demo(page);
  const id = await upload(page, 'responsive-long-filename-世界-document.bin');
  await page.request.post(`/api/files/${id}/shares`, { data: { max_downloads: 5 } });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/dashboard', '/files', `/files/${id}`, '/files/manage', '/shared', '/security', '/settings', '/access-logs', '/notifications']) {
    await page.goto(route);
    await expect(page.locator('body')).toBeVisible();
    if (route !== '/') await expect(page.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    if (route === `/files/${id}`) await expect(page.getByText('Unique 96-bit Nonce (Hex):')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Horizontal page overflow at ${route}`).toBe(true);
  }
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Files', exact: true }).click();
  await expect(page).toHaveURL(/\/files$/);
  await page.keyboard.press('Tab');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.screenshot({ path: info.outputPath('files-mobile.png'), fullPage: true });
  await page.goto(`/files/${id}`);
  await page.screenshot({ path: info.outputPath('file-details-mobile.png'), fullPage: true });
  await page.goto('/security');
  await expect(page.getByRole('button', { name: 'Revoke device', exact: true })).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Revoke device', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
