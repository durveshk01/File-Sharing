import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Switch,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import {
  getWifiOnlyPref,
  setWifiOnlyPref,
  getDataSaverPref,
  setDataSaverPref,
  getBiometricsPref,
  setBiometricsPref,
  getOrCreateDeviceId,
  clearSessionToken,
} from '../crypto/keyStorage';
import { isBiometricsAvailable } from '../services/biometrics';
import { BACKEND_API_URL, setCustomApiUrl, mobileApiRequest } from '../api/client';

interface Props {
  onSignOut: () => void;
}

export default function SettingsScreen({ onSignOut }: Props) {
  const [wifiOnly, setWifiOnly] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const [biometrics, setBiometrics] = useState(false);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [apiUrl, setApiUrl] = useState(BACKEND_API_URL);

  useEffect(() => {
    async function init() {
      const w = await getWifiOnlyPref();
      const d = await getDataSaverPref();
      const b = await getBiometricsPref();
      const bioAvail = await isBiometricsAvailable();
      const did = await getOrCreateDeviceId();

      setWifiOnly(w);
      setDataSaver(d);
      setBiometrics(b);
      setHasBiometrics(bioAvail);
      setDeviceId(did);
    }
    init();
  }, []);

  async function handleToggleWifi(val: boolean) {
    setWifiOnly(val);
    await setWifiOnlyPref(val);
  }

  async function handleToggleDataSaver(val: boolean) {
    setDataSaver(val);
    await setDataSaverPref(val);
  }

  async function handleToggleBiometrics(val: boolean) {
    if (val && !hasBiometrics) {
      Alert.alert('Not Supported', 'Biometric hardware is not configured or enrolled on this device.');
      return;
    }
    setBiometrics(val);
    await setBiometricsPref(val);
  }

  function handleSaveUrl() {
    setCustomApiUrl(apiUrl);
    Alert.alert('Configuration Saved', `Backend API URL updated to:\n${apiUrl}`);
  }

  async function handleLogout() {
    Alert.alert(
      'Sign Out',
      'Sign out from this device? Local encrypted files will remain safe in your vault.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await mobileApiRequest('/api/auth/logout', { method: 'POST' });
            } catch {}
            await clearSessionToken();
            onSignOut();
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings & Security</Text>
        <Text style={styles.subtitle}>Manage encryption, sync policy, and device hardware</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {/* Sync Preferences */}
        <Text style={styles.groupLabel}>SYNCHRONIZATION POLICY</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Wi-Fi Only Sync</Text>
              <Text style={styles.settingSubtitle}>Prevent uploads and downloads over cellular data</Text>
            </View>
            <Switch
              value={wifiOnly}
              onValueChange={handleToggleWifi}
              trackColor={{ false: '#374151', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>

          <View style={[styles.settingRow, { borderTopWidth: 1, borderTopColor: '#1f2937' }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Battery Saver Synchronization</Text>
              <Text style={styles.settingSubtitle}>Pause automatic background sync when battery is &lt; 15%</Text>
            </View>
            <Switch
              value={dataSaver}
              onValueChange={handleToggleDataSaver}
              trackColor={{ false: '#374151', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Biometrics */}
        <Text style={styles.groupLabel}>HARDWARE SECURITY</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingTitle}>Biometric Vault Lock</Text>
              <Text style={styles.settingSubtitle}>
                Require Fingerprint / Face ID to unlock encrypted vaults
              </Text>
            </View>
            <Switch
              value={biometrics}
              onValueChange={handleToggleBiometrics}
              trackColor={{ false: '#374151', true: '#3b82f6' }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Backend Endpoint Config */}
        <Text style={styles.groupLabel}>BACKEND COORDINATOR</Text>
        <View style={styles.card}>
          <Text style={styles.settingTitle}>Render / API Gateway URL</Text>
          <Text style={styles.settingSubtitle}>
            Configure the Render synchronization endpoint (e.g. Render production or LAN IP)
          </Text>
          <TextInput
            value={apiUrl}
            onChangeText={setApiUrl}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.btnSave} onPress={handleSaveUrl}>
            <Text style={styles.btnSaveText}>Save Endpoint</Text>
          </TouchableOpacity>
        </View>

        {/* Device Registration Info */}
        <Text style={styles.groupLabel}>DEVICE IDENTITY</Text>
        <View style={styles.card}>
          <Text style={styles.settingTitle}>Hardware Device ID</Text>
          <Text style={styles.deviceIdText} selectable>{deviceId}</Text>
          <Text style={styles.settingSubtitle}>
            Unique monotonic identifier used for cursor reconciliation and push sync.
          </Text>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.btnLogout} onPress={handleLogout}>
          <Text style={styles.btnLogoutText}>Sign Out from Device</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
    paddingTop: 16,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 10,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  settingSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  input: {
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 13,
    marginTop: 10,
    marginBottom: 10,
  },
  btnSave: {
    backgroundColor: '#1f2937',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  btnSaveText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60a5fa',
  },
  deviceIdText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#60a5fa',
    marginVertical: 6,
  },
  btnLogout: {
    marginTop: 20,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: '#ef4444',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnLogoutText: {
    color: '#f87171',
    fontSize: 14,
    fontWeight: '700',
  },
});
