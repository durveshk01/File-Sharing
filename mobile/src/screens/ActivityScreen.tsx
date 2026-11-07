import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { getPendingSyncTasks, SyncQueueItem } from '../database/sqlite';
import { processOfflineSyncQueue } from '../services/syncEngine';
import { mobileApiRequest } from '../api/client';

export default function ActivityScreen() {
  const [tasks, setTasks] = useState<SyncQueueItem[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    try {
      const pending = await getPendingSyncTasks();
      setTasks(pending);

      const actData = await mobileApiRequest('/api/access-logs').catch(() => []);
      setActivities(actData);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleRetryQueue() {
    setSyncing(true);
    try {
      const res = await processOfflineSyncQueue();
      Alert.alert('Queue Processed', `Synced: ${res.processed}, Failed: ${res.failed}`);
      await load();
    } catch (err: any) {
      Alert.alert('Sync Error', err.message);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Synchronization & Audit</Text>
        <Text style={styles.subtitle}>Offline-first queue and tamper-evident access log</Text>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {/* Offline Queue Section */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Offline Sync Queue ({tasks.length})</Text>
            {tasks.length > 0 && (
              <TouchableOpacity style={styles.btnRetry} onPress={handleRetryQueue} disabled={syncing}>
                <Text style={styles.btnRetryText}>{syncing ? 'Processing...' : 'Retry All'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {tasks.length === 0 ? (
            <Text style={styles.emptyText}>All offline changes are synchronized with the cloud.</Text>
          ) : (
            tasks.map((t) => (
              <View key={t.id} style={styles.taskRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskAction}>{t.action.toUpperCase()} Action</Text>
                  <Text style={styles.taskMeta}>Status: {t.status} • Retries: {t.retry_count}</Text>
                  {t.last_error && <Text style={styles.taskError}>Error: {t.last_error}</Text>}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Audit Log Section */}
        <Text style={styles.sectionTitle}>Immutable Access Trail</Text>
        {loading ? (
          <ActivityIndicator color="#3b82f6" style={{ marginTop: 20 }} />
        ) : activities.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No audit activity recorded.</Text>
          </View>
        ) : (
          activities.slice(0, 15).map((a, i) => (
            <View key={i} style={styles.auditRow}>
              <View style={styles.auditDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.auditAction}>{a.action}</Text>
                <Text style={styles.auditMeta}>
                  {a.result.toUpperCase()} • IP: {a.ip_address || 'Local Device'} • {new Date(a.created_at).toLocaleTimeString()}
                </Text>
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
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 20,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  btnRetry: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  btnRetryText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  taskRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  taskAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60a5fa',
  },
  taskMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  taskError: {
    fontSize: 11,
    color: '#f87171',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 12,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    marginBottom: 8,
  },
  auditDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3b82f6',
    marginRight: 12,
  },
  auditAction: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f8fafc',
  },
  auditMeta: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: '#111827',
    padding: 24,
    borderRadius: 10,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748b',
  },
});
