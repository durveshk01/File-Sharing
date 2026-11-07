import * as SQLite from 'expo-sqlite';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getLocalDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  const db = await SQLite.openDatabaseAsync('secureshare_local.db');
  
  // Initialize tables
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    
    CREATE TABLE IF NOT EXISTS local_files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      sha256_checksum TEXT,
      ciphertext_sha256 TEXT,
      local_path TEXT,
      encryption_version TEXT DEFAULT 'v2',
      is_available_offline INTEGER DEFAULT 0,
      sync_status TEXT DEFAULT 'synced',
      version INTEGER DEFAULT 1,
      created_at TEXT NOT NULL,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      file_id TEXT,
      action TEXT NOT NULL, -- 'upload', 'delete', 'rename'
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'failed', 'paused'
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  dbInstance = db;
  return db;
}

export interface LocalFileRecord {
  id: string;
  name: string;
  size: number;
  content_type: string;
  sha256_checksum?: string;
  ciphertext_sha256?: string;
  local_path?: string;
  encryption_version: string;
  is_available_offline: number;
  sync_status: 'synced' | 'local_only' | 'uploading' | 'downloading' | 'error';
  version: number;
  created_at: string;
  last_synced_at?: string;
}

export interface SyncQueueItem {
  id: string;
  file_id: string;
  action: 'upload' | 'delete' | 'rename';
  payload: string; // JSON
  status: 'pending' | 'in_progress' | 'failed' | 'paused';
  retry_count: number;
  last_error?: string;
  created_at: string;
}

export async function upsertLocalFile(file: LocalFileRecord): Promise<void> {
  const db = await getLocalDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO local_files (
      id, name, size, content_type, sha256_checksum, ciphertext_sha256,
      local_path, encryption_version, is_available_offline, sync_status,
      version, created_at, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      file.id,
      file.name,
      file.size,
      file.content_type,
      file.sha256_checksum || null,
      file.ciphertext_sha256 || null,
      file.local_path || null,
      file.encryption_version,
      file.is_available_offline,
      file.sync_status,
      file.version,
      file.created_at,
      file.last_synced_at || null,
    ]
  );
}

export async function getLocalFiles(): Promise<LocalFileRecord[]> {
  const db = await getLocalDatabase();
  return await db.getAllAsync<LocalFileRecord>(
    `SELECT * FROM local_files ORDER BY created_at DESC`
  );
}

export async function getOfflineAvailableFiles(): Promise<LocalFileRecord[]> {
  const db = await getLocalDatabase();
  return await db.getAllAsync<LocalFileRecord>(
    `SELECT * FROM local_files WHERE is_available_offline = 1 ORDER BY name ASC`
  );
}

export async function enqueueSyncTask(
  action: 'upload' | 'delete' | 'rename',
  fileId: string,
  payload: Record<string, any>
): Promise<string> {
  const db = await getLocalDatabase();
  const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await db.runAsync(
    `INSERT INTO sync_queue (id, file_id, action, payload, status, retry_count, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
    [id, fileId, action, JSON.stringify(payload), new Date().toISOString()]
  );
  return id;
}

export async function getPendingSyncTasks(): Promise<SyncQueueItem[]> {
  const db = await getLocalDatabase();
  return await db.getAllAsync<SyncQueueItem>(
    `SELECT * FROM sync_queue WHERE status = 'pending' ORDER BY created_at ASC`
  );
}

export async function updateSyncTaskStatus(
  id: string,
  status: 'pending' | 'in_progress' | 'failed' | 'paused',
  error?: string
): Promise<void> {
  const db = await getLocalDatabase();
  await db.runAsync(
    `UPDATE sync_queue 
     SET status = ?, 
         last_error = ?,
         retry_count = retry_count + (CASE WHEN ? = 'failed' THEN 1 ELSE 0 END)
     WHERE id = ?`,
    [status, error || null, status, id]
  );
}

export async function deleteSyncTask(id: string): Promise<void> {
  const db = await getLocalDatabase();
  await db.runAsync(`DELETE FROM sync_queue WHERE id = ?`, [id]);
}

export async function getSyncCursor(): Promise<string | null> {
  const db = await getLocalDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_metadata WHERE key = 'sync_cursor'`
  );
  return row ? row.value : null;
}

export async function setSyncCursor(cursor: string): Promise<void> {
  const db = await getLocalDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('sync_cursor', ?)`,
    [cursor]
  );
}
