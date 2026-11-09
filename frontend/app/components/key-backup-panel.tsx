'use client';

import { useState } from 'react';
import { Download, KeyRound, Upload } from 'lucide-react';
import { exportKeyBackup, restoreKeyBackup } from '../lib/keyVault';
import { triggerBlobDownload } from '../lib/downloader';

export default function KeyBackupPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function exportKeys() {
    setBusy(true); setError(''); setMessage('');
    try {
      const text = await exportKeyBackup();
      const bytes = new TextEncoder().encode(text);
      triggerBlobDownload(bytes.buffer as ArrayBuffer, 'secureshare-private-keys.json', 'application/json');
      setMessage('Private key backup downloaded. Keep it private and separate from your files.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Backup failed'); }
    finally { setBusy(false); }
  }
  async function importKeys(file: File) {
    setBusy(true); setError(''); setMessage('');
    try {
      if (file.size > 2 * 1048576) throw new Error('Select a key backup smaller than 2 MB');
      const count = await restoreKeyBackup(await file.text());
      setMessage(`Restored ${count} file key${count === 1 ? '' : 's'} for this account.`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not restore this backup'); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-title"><h3><KeyRound size={17} />Private file key backups</h3></div>
    <p style={{ color: 'var(--text-secondary)' }}>New v2 files need their device-held keys. Export includes this account’s saved keys and authorized legacy keys, including files in trash. Keep the private JSON backup somewhere safe before clearing browser data, and restore it on another device signed into this account.</p>
    <div className="toolbar">
      <button className="btn-primary" disabled={busy} onClick={exportKeys}><Download size={16} />Export private keys</button>
      <label className="btn-secondary" style={{ opacity: busy ? .6 : 1 }}><Upload size={16} />Restore a key backup
        <input type="file" accept=".json,application/json" disabled={busy} className="sr-only" onChange={(event) => {
          const file = event.target.files?.[0]; if (file) void importKeys(file); event.target.value = '';
        }} />
      </label>
    </div>
    {error && <div className="notice-error" role="alert">{error}</div>}
    {message && <div className="notice-success" role="status">{message}</div>}
  </section>;
}
