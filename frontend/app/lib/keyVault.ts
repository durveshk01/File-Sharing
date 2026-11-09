import { apiRequest, getBrowserAccountId, requireBrowserAccount } from "./api";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./crypto";

type KeyMap = Record<string, string>;
const LEGACY_KEY = "secureshare_file_keys";

export function validateFileKey(key: string): string {
  const normalized = key.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || base64ToArrayBuffer(normalized).byteLength !== 32) {
    throw new Error("A file key must contain exactly 32 bytes encoded as Base64");
  }
  return arrayBufferToBase64(base64ToArrayBuffer(normalized));
}

function storageKey(account: string): string { return `${LEGACY_KEY}:${account}`; }

function readKeys(account: string): KeyMap {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(account)) || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error("Saved file keys cannot be read. Restore a key backup before uploading new files.");
  }
}

export async function saveLocalFileKey(fileId: string, rawBase64Key: string, verifiedReplacement = false): Promise<void> {
  const account = getBrowserAccountId() || await requireBrowserAccount();
  const key = validateFileKey(rawBase64Key);
  const keys = readKeys(account);
  if (!verifiedReplacement && keys[fileId] && keys[fileId] !== key) throw new Error("A different key is already saved for this file");
  keys[fileId] = key;
  try {
    localStorage.setItem(storageKey(account), JSON.stringify(keys));
  } catch {
    throw new Error("This browser cannot save private file keys. Enable browser storage before uploading.");
  }
}

export async function getLocalFileKey(fileId: string): Promise<string | null> {
  const account = getBrowserAccountId() || await requireBrowserAccount();
  const keys = readKeys(account);
  if (keys[fileId]) return validateFileKey(keys[fileId]);

  // Adopt an old unscoped key only after the API confirms this account can read
  // the exact file. Keep the old entry so upgrading never discards a user's key.
  let legacy: KeyMap;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}"); } catch { return null; }
  if (typeof legacy?.[fileId] !== "string") return null;
  await apiRequest(`/api/files/${encodeURIComponent(fileId)}`);
  const key = validateFileKey(legacy[fileId]);
  await saveLocalFileKey(fileId, key);
  return key;
}

export async function exportKeyBackup(): Promise<string> {
  const account = await requireBrowserAccount();
  const keys = readKeys(account);
  let legacy: KeyMap;
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}");
    if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) throw new Error();
  } catch { throw new Error("Legacy private keys cannot be read. Keep your browser data and repair or recover those keys before exporting."); }
  // Authorize old keys against all account-accessible collections, including
  // trash, before export. Opening every old file first must not be necessary.
  const remaining = new Set(Object.keys(legacy).filter((id) => !keys[id]));
  for (const path of ["/api/files", "/api/files/trash", "/api/files/shared-with-me"]) {
    for (let offset = 0; remaining.size; offset += 500) {
      const files = await apiRequest<{ id: string }[]>(`${path}?limit=500&offset=${offset}`);
      for (const file of files) {
        if (!remaining.has(file.id)) continue;
        keys[file.id] = validateFileKey(legacy[file.id]);
        remaining.delete(file.id);
      }
      if (files.length < 500) break;
    }
  }
  if (await requireBrowserAccount() !== account) throw new Error("The signed-in account changed. Export your keys again.");
  for (const id of Object.keys(keys)) keys[id] = validateFileKey(keys[id]);
  localStorage.setItem(storageKey(account), JSON.stringify(keys));
  return JSON.stringify({ format: "secureshare-keys-v1", account_id: account, keys }, null, 2);
}

export async function restoreKeyBackup(text: string): Promise<number> {
  const account = await requireBrowserAccount();
  const backup = JSON.parse(text);
  if (backup?.format !== "secureshare-keys-v1" || backup.account_id !== account || !backup.keys
      || typeof backup.keys !== "object" || Array.isArray(backup.keys)) {
    throw new Error("Select a SecureShare key backup for the signed-in account");
  }
  const keys = readKeys(account);
  const entries = Object.entries(backup.keys);
  if (entries.length > 10000) throw new Error("Key backup contains too many entries");
  for (const [id, value] of entries) {
    if (!/^[a-f0-9-]{36}$/i.test(id) || typeof value !== "string") throw new Error("Invalid file key entry");
    const key = validateFileKey(value);
    if (keys[id] && keys[id] !== key) throw new Error(`Backup conflicts with an existing key for file ${id}`);
    keys[id] = key;
  }
  localStorage.setItem(storageKey(account), JSON.stringify(keys));
  return entries.length;
}
