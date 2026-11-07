import { apiRequest, API_URL } from "./api";
import {
  decryptFileBuffer,
  base64ToArrayBuffer,
  computeSHA256,
} from "./crypto";
import { getLocalFileKey } from "./uploader";

export async function downloadAndDecryptFile(
  fileId: string,
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  onProgress?.(10, "Requesting download authorization...");
  const intent = await apiRequest(`/api/files/${fileId}/download-intent`);

  let downloadUrl = intent.download_url;
  if (!downloadUrl.startsWith("http")) {
    downloadUrl = `${API_URL}${downloadUrl}`;
  }

  onProgress?.(30, "Downloading encrypted ciphertext...");
  const resp = await fetch(downloadUrl, { credentials: "include" });
  if (!resp.ok) {
    throw new Error(`Failed to download file from storage (status ${resp.status})`);
  }
  const ciphertextBuffer = await resp.arrayBuffer();

  onProgress?.(70, "Decrypting on device with AES-256-GCM...");
  let plainBuffer: ArrayBuffer;

  if (intent.encryption_version === "v2") {
    const keyBase64 = getLocalFileKey(fileId);
    if (!keyBase64) {
      throw new Error(
        "Decryption key not found on this device. Please import the file key to decrypt."
      );
    }
    const nonce = new Uint8Array(base64ToArrayBuffer(intent.nonce_b64));
    plainBuffer = await decryptFileBuffer(ciphertextBuffer, keyBase64, nonce, "v2");
  } else {
    // Fallback for legacy v1 files
    const legacyResp = await fetch(`${API_URL}/api/files/${fileId}/download`, {
      credentials: "include",
    });
    if (!legacyResp.ok) throw new Error("Legacy download failed");
    plainBuffer = await legacyResp.arrayBuffer();
  }

  // Integrity validation
  onProgress?.(90, "Verifying SHA-256 cryptographic checksum...");
  if (intent.sha256_checksum) {
    const calculatedSum = await computeSHA256(plainBuffer);
    if (calculatedSum !== intent.sha256_checksum) {
      throw new Error(
        "CRITICAL SECURITY ALERT: SHA-256 checksum mismatch! The file has been tampered with or corrupted."
      );
    }
  }

  onProgress?.(100, "Download ready!");
  triggerBlobDownload(plainBuffer, intent.name, intent.content_type);
}

export async function downloadAndDecryptSharedFile(
  token: string,
  keyBase64: string,
  grantToken?: string,
  onProgress?: (percent: number, status: string) => void
): Promise<void> {
  onProgress?.(10, "Authorizing zero-knowledge download...");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (grantToken) {
    headers["X-Share-Grant"] = grantToken;
  }

  const intent = await apiRequest(`/api/shares/${token}/download-intent`, {
    method: "POST",
    headers,
  });

  let downloadUrl = intent.download_url;
  if (!downloadUrl.startsWith("http")) {
    downloadUrl = `${API_URL}${downloadUrl}`;
  }

  onProgress?.(35, "Transferring encrypted ciphertext from cloud...");
  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    throw new Error(`Failed to retrieve encrypted object (status ${resp.status})`);
  }
  const ciphertextBuffer = await resp.arrayBuffer();

  onProgress?.(75, "Locally decrypting with AES-256-GCM...");
  const nonce = new Uint8Array(base64ToArrayBuffer(intent.nonce_b64));
  const plainBuffer = await decryptFileBuffer(
    ciphertextBuffer,
    keyBase64,
    nonce,
    intent.encryption_version || "v2"
  );

  onProgress?.(92, "Validating file integrity...");
  if (intent.sha256_checksum) {
    const calculatedSum = await computeSHA256(plainBuffer);
    if (calculatedSum !== intent.sha256_checksum) {
      throw new Error("Integrity check failed: plaintext does not match SHA-256 checksum");
    }
  }

  onProgress?.(100, "File decrypted successfully!");
  triggerBlobDownload(plainBuffer, intent.name, intent.content_type);
}

function triggerBlobDownload(buffer: ArrayBuffer, filename: string, mimeType: string = "application/octet-stream") {
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "downloaded_file";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
