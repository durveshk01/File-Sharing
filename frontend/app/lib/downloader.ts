import { apiFetch, apiRequest, requireBrowserAccount, responseError } from "./api";
import { decryptFileBuffer, base64ToArrayBuffer, computeSHA256 } from "./crypto";
import { getLocalFileKey, validateFileKey } from "./keyVault";

export type DownloadIntent = {
  name: string;
  size: number;
  content_type: string;
  encryption_version: string;
  nonce_b64: string;
  sha256_checksum?: string;
  ciphertext_sha256?: string;
  download_url: string;
  download_method: string;
  download_headers: Record<string, string>;
  mode: string;
};
type Progress = (percent: number, status: string) => void;

async function readIntent(intent: DownloadIntent, key: string | null, progress?: Progress): Promise<ArrayBuffer> {
  if (intent.encryption_version === "v2") {
    if (!key) throw new Error("This device has no decryption key. Open file details to import the key from another device or a backup.");
    key = validateFileKey(key);
  }
  progress?.(30, intent.encryption_version === "v2" ? "Downloading authorized ciphertext…" : "Downloading a server-decrypted legacy file…");
  const options: RequestInit = { method: intent.download_method || "GET", headers: intent.download_headers || {} };
  let response: Response;
  if (intent.download_url.startsWith("/api/")) {
    response = await apiFetch(intent.download_url, options);
  } else if (intent.mode === "direct_s3" && new URL(intent.download_url).protocol === "https:") {
    response = await fetch(intent.download_url, { method: options.method, credentials: "omit" });
  } else {
    throw new Error("Storage returned an unsupported download authorization");
  }
  if (!response.ok) throw await responseError(response);
  const bytes = await response.arrayBuffer();
  const expectedSize = intent.size + (intent.encryption_version === "v2" ? 16 : 0);
  if (bytes.byteLength !== expectedSize) throw new Error("Downloaded size does not match the file metadata");
  let plaintext = bytes;
  if (intent.encryption_version === "v2") {
    if (intent.ciphertext_sha256 && await computeSHA256(bytes) !== intent.ciphertext_sha256) {
      throw new Error("Ciphertext checksum does not match. The file was not saved.");
    }
    progress?.(70, "Decrypting and authenticating on this device…");
    plaintext = await decryptFileBuffer(bytes, key!, new Uint8Array(base64ToArrayBuffer(intent.nonce_b64)), "v2");
  }
  progress?.(90, "Verifying the original-byte SHA-256 checksum…");
  if (intent.sha256_checksum && await computeSHA256(plaintext) !== intent.sha256_checksum) {
    throw new Error("Plaintext checksum does not match. The file was not saved.");
  }
  progress?.(100, "Decryption and integrity checks passed");
  return plaintext;
}

export async function readDecryptedFile(fileId: string, progress?: Progress, importedKey?: string) {
  await requireBrowserAccount();
  const intent = await apiRequest<DownloadIntent>(`/api/files/${fileId}/download-intent`);
  const key = intent.encryption_version === "v2" ? importedKey || await getLocalFileKey(fileId) : null;
  return { intent, plaintext: await readIntent(intent, key, progress) };
}

export async function downloadAndDecryptFile(fileId: string, progress?: Progress): Promise<void> {
  progress?.(10, "Requesting download authorization…");
  const { intent, plaintext } = await readDecryptedFile(fileId, progress);
  triggerBlobDownload(plaintext, intent.name, intent.content_type);
}

export async function downloadAndDecryptSharedFile(token: string, keyBase64: string | null, grantToken?: string, progress?: Progress): Promise<void> {
  if (keyBase64) keyBase64 = validateFileKey(keyBase64);
  progress?.(10, "Authorizing this shared transfer…");
  const intent = await apiRequest<DownloadIntent>(`/api/shares/${token}/download-intent`, {
    method: "POST", headers: grantToken ? { "X-Share-Grant": grantToken } : {},
  });
  const plaintext = await readIntent(intent, keyBase64, progress);
  triggerBlobDownload(plaintext, intent.name, intent.content_type);
}

export function triggerBlobDownload(buffer: ArrayBuffer, filename: string, mimeType = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "downloaded_file";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
