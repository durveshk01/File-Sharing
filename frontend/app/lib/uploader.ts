import {
  generateDEK,
  generateNonce,
  computeSHA256,
  encryptFileBuffer,
  arrayBufferToBase64,
} from "./crypto";
import { apiRequest, requireBrowserAccount } from "./api";
import { saveLocalFileKey } from "./keyVault";
export { saveLocalFileKey, getLocalFileKey } from "./keyVault";

export interface UploadProgress {
  phase: "reading" | "encrypting" | "uploading" | "confirming" | "completed" | "error" | "paused";
  loaded: number;
  total: number;
  percent: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  error?: string;
}

export interface UploadJob {
  file: File;
  fileId?: string;
  progress: UploadProgress;
  abortController?: AbortController;
  xhr?: XMLHttpRequest;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}

export async function uploadDeviceEncryptedFile(
  file: File,
  onProgress: (p: UploadProgress) => void
): Promise<{ fileId: string; name: string; keyBase64: string }> {
  let fileId: string | null = null;
  let confirmed = false;
  try {
  if (!file.size) throw new Error("Empty files cannot be uploaded");
  await requireBrowserAccount();
  const usage = await apiRequest<{ max_file_bytes: number }>("/api/storage/usage");
  if (file.size > usage.max_file_bytes) throw new Error(`File exceeds the ${Math.round(usage.max_file_bytes / 1048576)} MB limit`);
  // Phase 1: Read file locally
  onProgress({
    phase: "reading",
    loaded: 0,
    total: file.size,
    percent: 10,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  const arrayBuffer = await file.arrayBuffer();
  const plaintextHash = await computeSHA256(arrayBuffer);

  // Phase 2: Local AES-256-GCM encryption
  onProgress({
    phase: "encrypting",
    loaded: file.size / 2,
    total: file.size,
    percent: 25,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  const { key, rawBase64 } = await generateDEK();
  const nonce = generateNonce();
  const ciphertextBuffer = await encryptFileBuffer(arrayBuffer, key, nonce);
  const ciphertextHash = await computeSHA256(ciphertextBuffer);

  // Phase 3: Request upload authorization from Render backend
  onProgress({
    phase: "uploading",
    loaded: 0,
    total: ciphertextBuffer.byteLength,
    percent: 30,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  const intent = await apiRequest("/api/storage/upload-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      ciphertext_size: ciphertextBuffer.byteLength,
      content_type: file.type || "application/octet-stream",
      sha256_checksum: plaintextHash,
      ciphertext_sha256: ciphertextHash,
      nonce_b64: arrayBufferToBase64(nonce),
      wrapped_key_b64: "", // Zero-knowledge: raw key kept client-side
      encryption_version: "v2",
    }),
  });

  if (typeof intent.file_id !== 'string') throw new Error('Upload authorization did not include a file ID');
  fileId = String(intent.file_id);
  await saveLocalFileKey(fileId, rawBase64);

  // Phase 4: Transfer ciphertext to object storage with actual progress
  const uploadUrl = intent.upload_url;
  const apiTransfer = uploadUrl.startsWith("/api/");
  if (!apiTransfer && (intent.mode !== "direct_s3" || new URL(uploadUrl).protocol !== "https:")) {
    throw new Error("Storage returned an unsupported upload authorization");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const now = Date.now();
        const timeDiff = (now - lastTime) / 1000;
        const bytesDiff = event.loaded - lastLoaded;
        const currentSpeed = timeDiff > 0.3 ? bytesDiff / timeDiff : 0;
        if (timeDiff > 0.3) {
          lastLoaded = event.loaded;
          lastTime = now;
        }

        const remainingBytes = event.total - event.loaded;
        const eta = currentSpeed > 0 ? Math.round(remainingBytes / currentSpeed) : 0;
        const uploadPercent = 30 + Math.round((event.loaded / event.total) * 60);

        onProgress({
          phase: "uploading",
          loaded: event.loaded,
          total: event.total,
          percent: Math.min(uploadPercent, 95),
          speedBytesPerSec: currentSpeed,
          etaSeconds: eta,
        });
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage transfer failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error("Network transfer to object storage failed"));
    xhr.ontimeout = () => reject(new Error("Transfer timed out. Check your connection and retry."));
    xhr.onabort = () => reject(new Error("Transfer was cancelled"));

    xhr.open(intent.upload_method || "PUT", uploadUrl, true);
    const headers = intent.upload_headers || {};
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v as string);
    }
    xhr.timeout = 300000;
    xhr.withCredentials = apiTransfer;
    xhr.send(ciphertextBuffer);
  });

  // Phase 5: Confirm upload with Render backend
  onProgress({
    phase: "confirming",
    loaded: ciphertextBuffer.byteLength,
    total: ciphertextBuffer.byteLength,
    percent: 98,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  await apiRequest(`/api/files/${fileId}/confirm-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertext_sha256: ciphertextHash }),
  });
  confirmed = true;

  onProgress({
    phase: "completed",
    loaded: file.size,
    total: file.size,
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  return { fileId, name: file.name, keyBase64: rawBase64 };
  } catch (error) {
    if (fileId && !confirmed) await apiRequest(`/api/files/${fileId}`, { method: "DELETE" }).catch(() => undefined);
    onProgress({ phase: "error", loaded: 0, total: file.size, percent: 0, speedBytesPerSec: 0,
      etaSeconds: 0, error: error instanceof Error ? error.message : "Upload failed" });
    throw error;
  }
}
