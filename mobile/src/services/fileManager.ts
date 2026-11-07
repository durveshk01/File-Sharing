/**
 * SecureShare Mobile Native File Manager
 *
 * Implements 100% device-powered file picking, reading, AES-256-GCM encryption,
 * decryption, hashing, local SQLite caching, and presigned cloud transfer.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  generateRandomDEK,
  generateRandomNonce,
  encryptBytes,
  decryptBytes,
  computeSHA256Hex,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from '../crypto/aesGcm';
import { storeFileKey, getFileKey, getOrCreateDeviceId } from '../crypto/keyStorage';
import { mobileApiRequest, BACKEND_API_URL } from '../api/client';
import { upsertLocalFile, enqueueSyncTask, LocalFileRecord } from '../database/sqlite';

export async function pickAndEncryptMobileFile(
  onProgress?: (status: string, percent: number) => void
): Promise<LocalFileRecord | null> {
  // Step 1: Native Document Picker
  onProgress?.('Selecting file...', 5);
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  const fileName = asset.name;
  const fileSize = asset.size || 0;
  const mimeType = asset.mimeType || 'application/octet-stream';

  // Step 2: Read file locally as Base64/Bytes
  onProgress?.('Reading local file...', 15);
  const base64Plain = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const plainBytes = base64ToUint8Array(base64Plain);

  // Step 3: Compute SHA-256 on plaintext locally
  onProgress?.('Calculating SHA-256 hash...', 25);
  const plaintextHash = await computeSHA256Hex(plainBytes);

  // Step 4: Generate 256-bit DEK & 96-bit Nonce locally
  const dek = generateRandomDEK();
  const nonce = generateRandomNonce();
  const dekBase64 = uint8ArrayToBase64(dek);
  const nonceBase64 = uint8ArrayToBase64(nonce);

  // Step 5: Locally encrypt with AES-256-GCM
  onProgress?.('Encrypting on device with AES-256-GCM...', 45);
  const cipherBytes = encryptBytes(plainBytes, dek, nonce);
  const cipherBase64 = uint8ArrayToBase64(cipherBytes);
  const cipherHash = await computeSHA256Hex(cipherBytes);

  // Save encrypted copy to local filesystem vault
  const localVaultDir = `${FileSystem.documentDirectory}vault/`;
  await FileSystem.makeDirectoryAsync(localVaultDir, { intermediates: true });
  const localEncryptedPath = `${localVaultDir}${asset.name}.enc`;
  await FileSystem.writeAsStringAsync(localEncryptedPath, cipherBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Step 6: Request Upload Authorization from Render
  onProgress?.('Authorizing cloud transfer...', 60);
  const deviceId = await getOrCreateDeviceId();

  try {
    const intent = await mobileApiRequest('/api/storage/upload-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fileName,
        size: fileSize,
        ciphertext_size: cipherBytes.byteLength,
        content_type: mimeType,
        sha256_checksum: plaintextHash,
        ciphertext_sha256: cipherHash,
        nonce_b64: nonceBase64,
        wrapped_key_b64: '', // Zero-knowledge: key never leaves device
        encryption_version: 'v2',
        device_id: deviceId,
      }),
    });

    const fileId = intent.file_id;
    await storeFileKey(fileId, dekBase64);

    // Step 7: Direct Encrypted Transfer (Presigned URL or direct raw storage)
    onProgress?.('Transferring ciphertext to object storage...', 75);
    let uploadUrl = intent.upload_url;
    if (!uploadUrl.startsWith('http')) {
      uploadUrl = `${BACKEND_API_URL}${uploadUrl}`;
    }

    const uploadRes = await FileSystem.uploadAsync(uploadUrl, localEncryptedPath, {
      httpMethod: intent.upload_method || 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: intent.upload_headers || {},
    });

    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      throw new Error(`Upload to storage returned status ${uploadRes.status}`);
    }

    // Step 8: Confirm upload with Render
    onProgress?.('Confirming sync state...', 90);
    await mobileApiRequest(`/api/files/${fileId}/confirm-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ciphertext_sha256: cipherHash }),
    });

    const localRecord: LocalFileRecord = {
      id: fileId,
      name: fileName,
      size: fileSize,
      content_type: mimeType,
      sha256_checksum: plaintextHash,
      ciphertext_sha256: cipherHash,
      local_path: localEncryptedPath,
      encryption_version: 'v2',
      is_available_offline: 1,
      sync_status: 'synced',
      version: 1,
      created_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
    };

    await upsertLocalFile(localRecord);
    onProgress?.('Complete!', 100);
    return localRecord;
  } catch (err: any) {
    // If offline, save to persistent sync queue!
    const localId = `local_${Date.now()}`;
    await storeFileKey(localId, dekBase64);
    const localRecord: LocalFileRecord = {
      id: localId,
      name: fileName,
      size: fileSize,
      content_type: mimeType,
      sha256_checksum: plaintextHash,
      ciphertext_sha256: cipherHash,
      local_path: localEncryptedPath,
      encryption_version: 'v2',
      is_available_offline: 1,
      sync_status: 'local_only',
      version: 1,
      created_at: new Date().toISOString(),
    };
    await upsertLocalFile(localRecord);
    await enqueueSyncTask('upload', localId, {
      fileName,
      fileSize,
      mimeType,
      plaintextHash,
      cipherHash,
      nonceBase64,
      localEncryptedPath,
    });
    onProgress?.('Queued for offline sync', 100);
    return localRecord;
  }
}

export async function downloadAndDecryptMobileFile(
  fileId: string,
  fileName: string,
  onProgress?: (status: string, percent: number) => void
): Promise<string> {
  onProgress?.('Requesting download authorization...', 10);
  const intent = await mobileApiRequest(`/api/files/${fileId}/download-intent`);

  let downloadUrl = intent.download_url;
  if (!downloadUrl.startsWith('http')) {
    downloadUrl = `${BACKEND_API_URL}${downloadUrl}`;
  }

  onProgress?.('Downloading encrypted ciphertext...', 35);
  const tempEncPath = `${FileSystem.cacheDirectory}${fileId}.enc`;
  const dlRes = await FileSystem.downloadAsync(downloadUrl, tempEncPath);

  if (dlRes.status !== 200) {
    throw new Error(`Download failed with status ${dlRes.status}`);
  }

  onProgress?.('Decrypting on device with AES-256-GCM...', 70);
  const keyBase64 = await getFileKey(fileId);
  if (!keyBase64) {
    throw new Error('Decryption key not present on this device');
  }

  const cipherBase64 = await FileSystem.readAsStringAsync(tempEncPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const cipherBytes = base64ToUint8Array(cipherBase64);
  const keyBytes = base64ToUint8Array(keyBase64);
  const nonceBytes = base64ToUint8Array(intent.nonce_b64);

  const plainBytes = decryptBytes(cipherBytes, keyBytes, nonceBytes);

  onProgress?.('Verifying SHA-256 integrity tag...', 90);
  if (intent.sha256_checksum) {
    const calcHash = await computeSHA256Hex(plainBytes);
    if (calcHash !== intent.sha256_checksum) {
      throw new Error('Integrity validation failed! Plaintext checksum mismatch.');
    }
  }

  // Save decrypted file to device downloads/documents
  const decryptedPath = `${FileSystem.documentDirectory}${fileName}`;
  const plainBase64 = uint8ArrayToBase64(plainBytes);
  await FileSystem.writeAsStringAsync(decryptedPath, plainBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  await FileSystem.deleteAsync(tempEncPath, { idempotent: true });
  onProgress?.('Decryption complete', 100);
  return decryptedPath;
}

export async function shareFileViaNativeShare(filePath: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();
  if (isAvailable) {
    await Sharing.shareAsync(filePath);
  }
}
