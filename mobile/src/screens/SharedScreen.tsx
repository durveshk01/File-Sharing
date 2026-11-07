import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { mobileApiRequest } from '../api/client';

export default function SharedScreen() {
  const [shares, setShares] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadShares() {
    try {
      const data = await mobileApiRequest('/api/shares');
      setShares(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadShares();
  }, []);

  async function handleNativeShare(s: any) {
    try {
      await Share.share({
        title: `SecureShare: ${s.file_name}`,
        message: `Secure document sharing link for "${s.file_name}":\n${s.url}`,
        url: s.url,
      });
    } catch (err: any) {
      Alert.alert('Share Error', err.message);
    }
  }

  async function handleRevoke(shareId: string) {
    Alert.alert(
      'Revoke Link',
      'Revoking this link will immediately prevent all recipients from accessing or downloading the file.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await mobileApiRequest(`/api/shares/${shareId}`, { method: 'DELETE' });
              await loadShares();
            } catch (err: any) {
              Alert.alert('Error', err.message || 'Could not revoke share link');
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Active Sharing Links</Text>
        <Text style={styles.subtitle}>
          Protected by zero-knowledge URL fragments & atomic download quotas
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {loading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
        ) : shares.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No active share links</Text>
            <Text style={styles.emptySubtitle}>
              Create a share link from the Files screen to distribute encrypted documents.
            </Text>
          </View>
        ) : (
          shares.map((s) => (
            <View key={s.id} style={styles.shareCard}>
              <View style={styles.shareTop}>
                <Text style={styles.fileName} numberOfLines={1}>{s.file_name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: s.revoked ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)' }]}>
                  <Text style={[styles.statusText, { color: s.revoked ? '#f87171' : '#34d399' }]}>
                    {s.revoked ? 'Revoked' : 'Active'}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Text style={styles.metaText}>
                  Downloads: <Text style={{ color: '#f8fafc', fontWeight: '600' }}>{s.downloads} / {s.max_downloads || '∞'}</Text>
                </Text>
                {s.expires_at && (
                  <Text style={styles.metaText}>
                    Expires: <Text style={{ color: '#f8fafc' }}>{new Date(s.expires_at).toLocaleDateString()}</Text>
                  </Text>
                )}
              </View>

              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.btnShare} onPress={() => handleNativeShare(s)}>
                  <Text style={styles.btnShareText}>Share via Native Sheet</Text>
                </TouchableOpacity>

                {!s.revoked && (
                  <TouchableOpacity style={styles.btnRevoke} onPress={() => handleRevoke(s.id)}>
                    <Text style={styles.btnRevokeText}>Revoke</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
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
  shareCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 12,
  },
  shareTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  fileName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    flex: 1,
    marginRight: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  metaText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 10,
  },
  btnShare: {
    flex: 1,
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  btnShareText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  btnRevoke: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  btnRevokeText: {
    color: '#f87171',
    fontSize: 12,
    fontWeight: '600',
  },
  empty: {
    backgroundColor: '#111827',
    padding: 40,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  emptySubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
    textAlign: 'center',
  },
});
