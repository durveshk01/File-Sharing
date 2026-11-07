import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import { getLocalFiles, getOfflineAvailableFiles, LocalFileRecord } from '../database/sqlite';
import { downloadAndDecryptMobileFile, shareFileViaNativeShare } from '../services/fileManager';
import { getFileKey } from '../crypto/keyStorage';
import { mobileApiRequest, BACKEND_API_URL } from '../api/client';

export default function FilesScreen() {
  const [files, setFiles] = useState<LocalFileRecord[]>([]);
  const [tab, setTab] = useState<'all' | 'offline'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [decryptingFileId, setDecryptingFileId] = useState<string | null>(null);

  async function load() {
    try {
      const list = tab === 'all' ? await getLocalFiles() : await getOfflineAvailableFiles();
      setFiles(list);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [tab]);

  async function handleDecryptAndOpen(f: LocalFileRecord) {
    setDecryptingFileId(f.id);
    try {
      const decryptedPath = await downloadAndDecryptMobileFile(f.id, f.name);
      setDecryptingFileId(null);
      Alert.alert(
        'Decrypted on Device',
        `Successfully decrypted "${f.name}". Integrity tag verified against SHA-256.`,
        [
          { text: 'Close', style: 'cancel' },
          { text: 'Open in App / Share', onPress: () => shareFileViaNativeShare(decryptedPath) },
        ]
      );
    } catch (err: any) {
      setDecryptingFileId(null);
      Alert.alert('Decryption Error', err.message);
    }
  }

  async function handleShare(f: LocalFileRecord) {
    try {
      const res = await mobileApiRequest(`/api/files/${f.id}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expires_in_hours: 24, max_downloads: 10 }),
      });

      let shareUrl = res.url;
      const key = await getFileKey(f.id);
      if (key) {
        shareUrl += `#key=${key}`;
      }

      await Share.share({
        title: `SecureShare: ${f.name}`,
        message: `I've shared an end-to-end encrypted document with you: ${f.name}\n${shareUrl}`,
        url: shareUrl,
      });
    } catch (err: any) {
      Alert.alert('Share Error', err.message);
    }
  }

  async function handleDelete(f: LocalFileRecord) {
    Alert.alert(
      'Move to Trash',
      `Are you sure you want to move "${f.name}" to trash?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Trash File',
          style: 'destructive',
          onPress: async () => {
            try {
              await mobileApiRequest(`/api/files/${f.id}/trash`, { method: 'POST' });
              await load();
            } catch (err: any) {
              Alert.alert('Delete Error', err.message);
            }
          },
        },
      ]
    );
  }

  const filtered = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Encrypted Vault Files</Text>
        <Text style={styles.subtitle}>Protected by AES-256-GCM Authenticated Encryption</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabsRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'all' && styles.tabBtnActive]}
          onPress={() => setTab('all')}
        >
          <Text style={[styles.tabBtnText, tab === 'all' && styles.tabBtnTextActive]}>
            All Vault Files ({files.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, tab === 'offline' && styles.tabBtnActive]}
          onPress={() => setTab('offline')}
        >
          <Text style={[styles.tabBtnText, tab === 'offline' && styles.tabBtnTextActive]}>
            Offline Available
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          placeholder="Search by file name..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
        />
      </View>

      {/* List */}
      <ScrollView contentContainerStyle={styles.scrollList}>
        {loading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No files found</Text>
            <Text style={styles.emptySubtitle}>
              {search ? 'Try another search term.' : 'Your encrypted vault is empty.'}
            </Text>
          </View>
        ) : (
          filtered.map((f) => (
            <View key={f.id} style={styles.fileCard}>
              <View style={styles.fileCardTop}>
                <View style={styles.fileIcon}>
                  <Text style={{ fontSize: 20 }}>📄</Text>
                </View>
                <View style={styles.fileCardInfo}>
                  <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                  <Text style={styles.fileMeta}>
                    {(f.size / 1024).toFixed(1)} KB • {f.encryption_version === 'v2' ? 'Device AES-GCM' : 'Envelope v1'}
                  </Text>
                </View>
                {f.is_available_offline === 1 && (
                  <View style={styles.offlineBadge}>
                    <Text style={styles.offlineBadgeText}>Offline</Text>
                  </View>
                )}
              </View>

              {f.sha256_checksum && (
                <Text style={styles.checksumText} numberOfLines={1}>
                  SHA-256: {f.sha256_checksum}
                </Text>
              )}

              {/* Action Buttons */}
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() => handleDecryptAndOpen(f)}
                  disabled={decryptingFileId === f.id}
                >
                  {decryptingFileId === f.id ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.actionBtnTextPrimary}>Decrypt & Open</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionBtnSecondary}
                  onPress={() => handleShare(f)}
                >
                  <Text style={styles.actionBtnTextSecondary}>Share</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionBtnDanger}
                  onPress={() => handleDelete(f)}
                >
                  <Text style={styles.actionBtnTextDanger}>Trash</Text>
                </TouchableOpacity>
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
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 14,
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  tabBtnActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: '#3b82f6',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabBtnTextActive: {
    color: '#60a5fa',
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  searchInput: {
    height: 40,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 8,
    paddingHorizontal: 14,
    color: '#f8fafc',
    fontSize: 13,
  },
  scrollList: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  fileCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 12,
  },
  fileCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileCardInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  fileMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  offlineBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  offlineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34d399',
  },
  checksumText: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#64748b',
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    paddingTop: 10,
  },
  actionBtn: {
    flex: 2,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPrimary: {
    backgroundColor: '#3b82f6',
  },
  actionBtnTextPrimary: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnSecondary: {
    flex: 1,
    backgroundColor: '#1f2937',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  actionBtnTextSecondary: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '600',
  },
  actionBtnDanger: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  actionBtnTextDanger: {
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
  },
});
