'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Files, Gauge, KeyRound, Settings, Share2 } from 'lucide-react';
import { apiRequest, ApiError } from '../lib/api';

const items = [
  { href: '/dashboard', label: 'Overview', icon: Gauge },
  { href: '/files', label: 'Files', icon: Files },
  { href: '/shared', label: 'Links', icon: Share2 },
  { href: '/security', label: 'Security', icon: KeyRound },
  { href: '/settings', label: 'Settings', icon: Settings },
];
const routes = ['/dashboard', '/files', '/shared', '/security', '/settings', '/access-logs', '/notifications'];

export default function WorkspaceNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = routes.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  useEffect(() => {
    if (!workspace) return;
    const expired = () => router.replace('/login');
    window.addEventListener('secureshare:session-expired', expired);
    let cancelled = false;
    async function registerBrowser() {
      try {
        const account = await apiRequest<{ id: string }>('/api/auth/me');
        if (cancelled) return;
        const storageKey = `secureshare_device_id:${account.id}`;
        let deviceId: string;
        try {
          deviceId = localStorage.getItem(storageKey) || crypto.randomUUID();
          localStorage.setItem(storageKey, deviceId);
        } catch { return; }
        const register = (id: string) => apiRequest('/api/sync/device/register', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: id, device_name: 'SecureShare browser', device_type: 'web' }),
        });
        try { await register(deviceId); } catch (error) {
          if (error instanceof ApiError && error.status === 409 && error.message.includes('revoked')) {
            deviceId = crypto.randomUUID();
            localStorage.setItem(storageKey, deviceId);
            await register(deviceId);
          }
        }
      } catch { /* Screen requests report connectivity failures; 401 emits the session event. */ }
    }
    void registerBrowser();
    return () => { cancelled = true; window.removeEventListener('secureshare:session-expired', expired); };
  }, [workspace, router]);

  if (!workspace) return null;
  return <>
    <a className="skip-link" href="#main-content" onClick={(event) => {
      const main = document.querySelector('main');
      if (main) { event.preventDefault(); main.tabIndex = -1; main.focus(); main.scrollIntoView(); }
    }}>Skip to content</a>
    <nav className="workspace-mobile-nav" aria-label="Workspace navigation">
      {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? 'page' : undefined}>
        <Icon size={19} aria-hidden="true" />{label}
      </Link>)}
    </nav>
  </>;
}
