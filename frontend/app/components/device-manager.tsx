'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api';

type Device = { id: string; device_name: string; device_type: string; last_seen_at: string; last_synced_at?: string };
export default function DeviceManager() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  async function load() {
    setLoading(true); setError('');
    try { setDevices(await apiRequest('/api/sync/devices')); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load registered devices'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function revoke(device: Device) {
    if (!confirm(`Revoke "${device.device_name}"? Its bound sessions will be signed out.`)) return;
    setBusy(device.id); setError('');
    try { await apiRequest(`/api/sync/devices/${device.id}`, { method: 'DELETE' }); await load(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not revoke device'); }
    finally { setBusy(null); }
  }
  return <section className="panel">
    <div className="panel-title"><h3><Smartphone size={17} />Registered devices</h3><button className="btn-secondary btn-sm" disabled={loading} onClick={load}><RefreshCw size={14} />Refresh</button></div>
    <p style={{ color: 'var(--text-secondary)' }}>Revoking a device signs out its bound sessions. A new sign-in is required to register it again.</p>
    {error && <div className="notice-error" role="alert">{error}</div>}
    {loading ? <p role="status">Loading devices…</p> : !devices.length ? <p>No devices have registered yet.</p> :
      <div className="device-list">{devices.map((device) => <div key={device.id} className="device-row">
        <div><strong>{device.device_name}</strong><small>{device.device_type} · Last seen {new Date(device.last_seen_at).toLocaleString()}</small></div>
        <button className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => revoke(device)}><Trash2 size={14} />{busy === device.id ? 'Revoking…' : 'Revoke device'}</button>
      </div>)}</div>}
  </section>;
}
