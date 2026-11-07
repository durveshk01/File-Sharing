import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const KEY_SESSION_TOKEN = 'secureshare_session_token';
const KEY_DEVICE_ID = 'secureshare_device_id';
const KEY_WIFI_ONLY = 'secureshare_pref_wifi_only';
const KEY_DATA_SAVER = 'secureshare_pref_data_saver';
const KEY_BIOMETRIC_ENABLED = 'secureshare_pref_biometrics';

export async function getOrCreateDeviceId(): Promise<string> {
  let deviceId = await SecureStore.getItemAsync(KEY_DEVICE_ID);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY_DEVICE_ID, deviceId);
  }
  return deviceId;
}

export async function storeSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY_SESSION_TOKEN, token);
}

export async function getSessionToken(): Promise<string | null> {
  return await SecureStore.getItemAsync(KEY_SESSION_TOKEN);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SESSION_TOKEN);
}

export async function storeFileKey(fileId: string, base64Key: string): Promise<void> {
  await SecureStore.setItemAsync(`dek_${fileId}`, base64Key);
}

export async function getFileKey(fileId: string): Promise<string | null> {
  return await SecureStore.getItemAsync(`dek_${fileId}`);
}

export async function deleteFileKey(fileId: string): Promise<void> {
  await SecureStore.deleteItemAsync(`dek_${fileId}`);
}

// User Sync Preferences
export async function setWifiOnlyPref(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_WIFI_ONLY, enabled ? 'true' : 'false');
}

export async function getWifiOnlyPref(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(KEY_WIFI_ONLY);
  return val === 'true';
}

export async function setDataSaverPref(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_DATA_SAVER, enabled ? 'true' : 'false');
}

export async function getDataSaverPref(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(KEY_DATA_SAVER);
  return val === 'true';
}

export async function setBiometricsPref(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(KEY_BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
}

export async function getBiometricsPref(): Promise<boolean> {
  const val = await SecureStore.getItemAsync(KEY_BIOMETRIC_ENABLED);
  return val === 'true';
}
