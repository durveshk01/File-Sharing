/**
 * SecureShare Device-Powered Cryptography (Web Crypto API)
 *
 * Implements client-side AES-256-GCM authenticated encryption and SHA-256 integrity verification.
 * New v2 keys and plaintext file contents never touch the server.
 */

const AAD = new TextEncoder().encode("secureshare:file:v2");

export async function generateDEK(): Promise<{ key: CryptoKey; rawBase64: string }> {
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await window.crypto.subtle.exportKey("raw", key);
  const rawBase64 = arrayBufferToBase64(exported);
  return { key, rawBase64 };
}

export function generateNonce(): Uint8Array {
  const nonce = new Uint8Array(12);
  window.crypto.getRandomValues(nonce);
  return nonce;
}

export async function computeSHA256(data: ArrayBuffer | Uint8Array): Promise<string> {
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encryptFileBuffer(
  plaintext: ArrayBuffer,
  key: CryptoKey,
  nonce: Uint8Array
): Promise<ArrayBuffer> {
  return await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce as BufferSource,
      additionalData: AAD,
      tagLength: 128,
    },
    key,
    plaintext
  );
}

export async function decryptFileBuffer(
  ciphertext: ArrayBuffer,
  keyOrBase64: CryptoKey | string,
  nonce: Uint8Array,
  version: string = "v2"
): Promise<ArrayBuffer> {
  let key: CryptoKey;
  if (typeof keyOrBase64 === "string") {
    key = await importDEK(keyOrBase64);
  } else {
    key = keyOrBase64;
  }

  const aad = version === "v1" 
    ? new TextEncoder().encode("secureshare:file:v1")
    : AAD;

  try {
    return await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: nonce as BufferSource,
        additionalData: aad,
        tagLength: 128,
      },
      key,
      ciphertext
    );
  } catch {
    // Web Crypto may reject with an OperationError whose message is empty.
    throw new Error("Decryption could not authenticate the file. The private key is incorrect or the encrypted file was changed.");
  }
}

export async function importDEK(base64Key: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64Key);
  return await window.crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  let binary = "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // Normalize URL-safe base64
  let normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) {
    normalized += "=";
  }
  const binaryString = window.atob(normalized);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
