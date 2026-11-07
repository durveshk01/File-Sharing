import * as LocalAuthentication from 'expo-local-authentication';
import { getBiometricsPref } from '../crypto/keyStorage';

export async function isBiometricsAvailable(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  return hasHardware && isEnrolled;
}

export async function promptBiometricAuth(): Promise<boolean> {
  const enabled = await getBiometricsPref();
  if (!enabled) return true;

  const available = await isBiometricsAvailable();
  if (!available) return true;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Unlock SecureShare Encrypted Vault',
    fallbackLabel: 'Use Device PIN',
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });

  return result.success;
}
