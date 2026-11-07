import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native';
import { pickAndEncryptMobileFile, downloadAndDecryptMobileFile, shareFileViaNativeShare } from '../services/fileManager';
import { processOfflineSyncQueue, pullDeltaChanges } from '../services/syncEngine';
import { getLocalFiles, LocalFileRecord, getPendingSyncTasks } from '../database/sqlite';
import * as Network from 'expo-network';

interface Props {
  onNavigateFiles: () => void;
}

export default function HomeScreen({ onNavigateFiles }: Props) {
  const [files, setFiles] = useState<LocalFileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [networkType, setNetworkType] = useState('Checking...');
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadPercent, setUploadPercent] = useState(0);

  async function loadData() {
    try {
      const localList = await getLocalFiles();
      setFiles(localList);

      const tasks = await getPendingSyncTasks();
      setPendingCount(tasks.length);

      const net = await Network.getNetworkStateAsync();
      setNetworkType(
        !net.isConnected
          ? 'Offline'
          : net.type === Network.NetworkStateType.WIFI
          ? 'Wi-Fi'
          : 'Cellular'
      );
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleQuickUpload() {
    try {
      setUploadStatus('Initializing device encryption...');
      setUploadPercent(5);

      const record = await pickAndEncryptMobileFile((status, pct) => {
        setUploadStatus(status);
        setUploadPercent(pct);
      });

      if (record) {
        Alert.alert(
          'Upload Complete',
          `"${record.name}" encrypted with AES-256-GCM and synchronized.`
        );
      }
      setTimeout(() => setUploadStatus(null), 1500);
      await loadData();
    } catch (err: any) {
      Alert.alert('Upload Error', err.message);
      setUploadStatus(null);
    }
  }

  async function handleSyncNow() {
    setRefreshing(true);
    try {
      await processOfflineSyncQueue();
      await pullDeltaChanges();
      await loadData();
    } catch (err: any) {
      Alert.alert('Sync Notice', err.message || 'Could not complete cloud sync');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDownloadAndOpen(f: LocalFileRecord) {
    try {
      setUploadStatus(`Decrypting "${f.name}" on device...`);
      const decryptedPath = await downloadAndDecryptMobileFile(f.id, f.name);
      setUploadStatus(null);
      Alert.alert(
        'Decrypted Successfully',
        'Would you like to open or share this file?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Share / Open', onPress: () => shareFileViaNativeShare(decryptedPath) },
        ]
      );
    } catch (err: any) {
      setUploadStatus(null);
      Alert.alert('Decryption Failed', err.message);
    }
  }

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <View style={styles.container}>
      {/* Upload Progress Banner */}
      {uploadStatus && (
        <View style={styles.progressBanner}>
          <Text style={styles.progressText}>{uploadStatus} ({uploadPercent}%)</Text>
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${uploadPercent}%` }]} />
          </View>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleSyncNow} tintColor="#3b82f6" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>SecureShare</Text>
            <Text style={styles.headerSubtitle}>Device-Powered Encrypted Vault</Text>
          </View>
          <View style={styles.badge}>
            <View style={[styles.badgeDot, { backgroundColor: networkType === 'Offline' ? '#f87171' : '#34d399' }]} />
            <Text style={styles.badgeText}>{networkType}</Text>
          </View>
        </View>

        {/* Storage Card */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>LOCAL & CLOUD STORAGE</Text>
          <Text style={styles.cardValue}>{(totalBytes / (1024 * 1024)).toFixed(2)} MB</Text>
          <Text style={styles.cardSubtext}>{files.length} Total Encrypted Files</Text>
          <View style={styles.storageBreakdown}>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownTitle}>Cipher</Text>
              <Text style={styles.breakdownVal}>AES-256-GCM</Text>
            </View>
            <View style={styles.breakdownItem}>
              <Text style={styles.breakdownTitle}>Storage Target</Text>
              <Text style={styles.breakdownVal}>Private S3 / Local</Text>
            </View>
          </View>
        </View>

        {/* Sync Status Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>OFFLINE SYNC ENGINE</Text>
            <TouchableOpacity onPress={handleSyncNow} style={styles.btnSmall}>
              <Text style={styles.btnSmallText}>Sync Delta</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.cardValue}>
            {pendingCount === 0 ? 'Fully Synchronized' : `${pendingCount} Pending Operation(s)`}
          </Text>
          <Text style={styles.cardSubtext}>
            Offline-first architecture: changes queue locally until connected.
          </Text>
        </View>

        {/* Recent Files Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Encrypted Files</Text>
          <TouchableOpacity onPress={onNavigateFiles}>
            <Text style={styles.sectionLink}>View All ({files.length})</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginVertical: 20 }} />
        ) : files.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No encrypted files on this device.</Text>
            <Text style={styles.emptySubtext}>Tap "Upload Encrypted File" below to begin.</Text>
          </View>
        ) : (
          files.slice(0, 5).map((f) => (
            <TouchableOpacity
              key={f.id}
              style={styles.fileRow}
              onPress={() => handleDownloadAndOpen(f)}
            >
              <View style={styles.fileIconBox}>
                <Text style={styles.fileIconText}>🔒</Text>
              </View>
              <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                <Text style={styles.fileMeta}>
                  {(f.size / 1024).toFixed(1)} KB • {f.sync_status}
                </Text>
              </View>
              <Text style={styles.actionArrow}>Decrypt ›</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Quick Upload FAB Button */}
      <TouchableOpacity style={styles.fab} onPress={handleQuickUpload} activeOpacity={0.85}>
        <Text style={styles.fabText}>+ Upload Encrypted File</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 90,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    marginTop: 10,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#f8fafc',
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1f2937',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 12,
    color: '#f8fafc',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f8fafc',
    marginVertical: 4,
  },
  cardSubtext: {
    fontSize: 12,
    color: '#94a3b8',
  },
  storageBreakdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    marginTop: 14,
    paddingTop: 12,
  },
  breakdownItem: {
    flex: 1,
  },
  breakdownTitle: {
    fontSize: 11,
    color: '#64748b',
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60a5fa',
    marginTop: 2,
  },
  btnSmall: {
    backgroundColor: '#1f2937',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#374151',
  },
  btnSmallText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#60a5fa',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
  },
  sectionLink: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '600',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 10,
  },
  fileIconBox: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#1f2937',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  fileIconText: {
    fontSize: 18,
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#f8fafc',
  },
  fileMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  actionArrow: {
    fontSize: 13,
    color: '#3b82f6',
    fontWeight: '600',
  },
  emptyContainer: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
  },
  emptySubtext: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fabText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  progressBanner: {
    backgroundColor: '#1e3a8a',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2563eb',
  },
  progressText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#34d399',
  },
});
