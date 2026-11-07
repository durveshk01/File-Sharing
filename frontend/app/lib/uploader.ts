import {
  generateDEK,
  generateNonce,
  computeSHA256,
  encryptFileBuffer,
  arrayBufferToBase64,
} from "./crypto";
import { apiRequest, API_URL } from "./api";

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

export function saveLocalFileKey(fileId: string, rawBase64Key: string) {
  if (typeof window !== "undefined") {
    try {
      const keys = JSON.parse(localStorage.getItem("secureshare_file_keys") || "{}");
      keys[fileId] = rawBase64Key;
      localStorage.setItem("secureshare_file_keys", JSON.stringify(keys));
    } catch {}
  }
}

export function getLocalFileKey(fileId: string): string | null {
  if (typeof window !== "undefined") {
    try {
      const keys = JSON.parse(localStorage.getItem("secureshare_file_keys") || "{}");
      return keys[fileId] || null;
    } catch {}
  }
  return null;
}

export async function uploadDeviceEncryptedFile(
  file: File,
  onProgress: (p: UploadProgress) => void
): Promise<{ fileId: string; name: string; keyBase64: string }> {
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

  const fileId = intent.file_id;
  saveLocalFileKey(fileId, rawBase64);

  // Phase 4: Transfer ciphertext to object storage with actual progress
  let uploadUrl = intent.upload_url;
  if (!uploadUrl.startsWith("http")) {
    uploadUrl = `${API_URL}${uploadUrl}`;
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

    xhr.open(intent.upload_method || "PUT", uploadUrl, true);
    const headers = intent.upload_headers || {};
    for (const [k, v] of Object.entries(headers)) {
      xhr.setRequestHeader(k, v as string);
    }
    // If uploading to local backend raw endpoint, provide session token or cookie
    const token = localStorage.getItem("secureshare_token");
    if (token && uploadUrl.includes("/api/storage/raw/")) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.withCredentials = true;
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

  onProgress({
    phase: "completed",
    loaded: file.size,
    total: file.size,
    percent: 100,
    speedBytesPerSec: 0,
    etaSeconds: 0,
  });

  return { fileId, name: file.name, keyBase64: rawBase64 };
}
