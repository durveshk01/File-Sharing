import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { mobileApiRequest } from '../api/client';
import { storeSessionToken, getOrCreateDeviceId } from '../crypto/keyStorage';

interface Props {
  onAuthenticated: () => void;
}

export default function AuthScreen({ onAuthenticated }: Props) {
  const [isRegister, setIsRegister] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleAuth() {
    if (!email || !password || (isRegister && !name)) {
      Alert.alert('Required Fields', 'Please complete all required fields.');
      return;
    }

    setLoading(true);
    try {
      if (isRegister) {
        await mobileApiRequest('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        Alert.alert(
          'Account Created',
          'Verification email sent. In development/console mode, your account is ready to sign in.'
        );
        setIsRegister(false);
      } else {
        const res = await mobileApiRequest('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        if (res.token) {
          await storeSessionToken(res.token);
          // Register device
          const deviceId = await getOrCreateDeviceId();
          await mobileApiRequest('/api/sync/device/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              device_id: deviceId,
              device_name: `${Platform.OS === 'android' ? 'Android Device' : 'iOS Device'}`,
              device_type: 'mobile',
            }),
          }).catch(() => null);

          onAuthenticated();
        } else {
          throw new Error('No authentication token received');
        }
      }
    } catch (err: any) {
      Alert.alert('Authentication Notice', err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin() {
    setLoading(true);
    try {
      const res = await mobileApiRequest('/api/auth/demo', { method: 'POST' });
      if (res.token) {
        await storeSessionToken(res.token);
        const deviceId = await getOrCreateDeviceId();
        await mobileApiRequest('/api/sync/device/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            device_id: deviceId,
            device_name: `${Platform.OS === 'android' ? 'Android Mobile' : 'iOS Mobile'} (Demo)`,
            device_type: 'mobile',
          }),
        }).catch(() => null);

        onAuthenticated();
      }
    } catch (err: any) {
      Alert.alert('Demo Login Error', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Brand */}
        <View style={styles.brandBox}>
          <View style={styles.logoCircle}>
            <Text style={{ fontSize: 28 }}>🔒</Text>
          </View>
          <Text style={styles.brandName}>SecureShare</Text>
          <Text style={styles.brandTagline}>Device-Powered Encrypted Cloud Vault</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={styles.formTitle}>{isRegister ? 'Create Mobile Vault' : 'Welcome Back'}</Text>

          {isRegister && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="Jane Doe"
                placeholderTextColor="#64748b"
                value={name}
                onChangeText={setName}
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>EMAIL ADDRESS</Text>
            <TextInput
              style={styles.input}
              placeholder="user@example.com"
              placeholderTextColor="#64748b"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>MASTER PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="••••••••••••"
              placeholderTextColor="#64748b"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity style={styles.btnPrimary} onPress={handleAuth} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>{isRegister ? 'Register Vault' : 'Sign In'}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnDemo} onPress={handleDemoLogin} disabled={loading}>
            <Text style={styles.btnDemoText}>✨ One-Tap Instant Demo Login</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchBtn}
            onPress={() => setIsRegister(!isRegister)}
          >
            <Text style={styles.switchText}>
              {isRegister
                ? 'Already have an account? Sign In'
                : "Don't have an account? Create Vault"}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  scroll: {
    padding: 24,
    justifyContent: 'center',
    minHeight: '100%',
  },
  brandBox: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#1e3a8a',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  brandTagline: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  input: {
    height: 44,
    backgroundColor: '#1f2937',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 8,
    paddingHorizontal: 14,
    color: '#f8fafc',
    fontSize: 14,
  },
  btnPrimary: {
    backgroundColor: '#3b82f6',
    borderRadius: 10,
    height: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  btnDemo: {
    backgroundColor: '#10b981',
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  btnDemoText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  switchBtn: {
    marginTop: 18,
    alignItems: 'center',
  },
  switchText: {
    fontSize: 13,
    color: '#60a5fa',
    fontWeight: '600',
  },
});
