/**
 * SecureShare Mobile Cryptographic Engine
 *
 * Performs 100% of cryptographic operations on the physical mobile device.
 * Features:
 * - 256-bit Data Encryption Key (DEK) generation
 * - 96-bit cryptographically random nonces
 * - Authenticated Encryption with Associated Data (AES-256-GCM) with 128-bit authentication tags
 * - SHA-256 cryptographic hashing and tamper verification
 */

import * as Crypto from 'expo-crypto';
import { gcm } from '@noble/ciphers/aes';

const AAD = new TextEncoder().encode('secureshare:file:v2');

export function generateRandomDEK(): Uint8Array {
  return Crypto.getRandomBytes(32);
}

export function generateRandomNonce(): Uint8Array {
  return Crypto.getRandomBytes(12);
}

export async function computeSHA256Hex(data: Uint8Array | string): Promise<string> {
  if (typeof data === 'string') {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, data);
  }
  // For binary data
  const base64Str = uint8ArrayToBase64(data);
  return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, base64Str, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
}

export function encryptBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  const cipher = gcm(key, nonce, AAD);
  return cipher.encrypt(plaintext);
}

export function decryptBytes(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Uint8Array {
  const cipher = gcm(key, nonce, AAD);
  return cipher.decrypt(ciphertext);
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  let normalized = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) {
    normalized += '=';
  }
  const binaryString = atob(normalized);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
