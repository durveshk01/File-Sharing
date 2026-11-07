import { getSessionToken, getOrCreateDeviceId } from '../crypto/keyStorage';

// Configurable API URL: default localhost (for Android emulator: 10.0.2.2, for device: LAN IP or Render URL)
export let BACKEND_API_URL = 'http://10.0.2.2:8000';

export function setCustomApiUrl(url: string) {
  BACKEND_API_URL = url.replace(/\/$/, '');
}

export async function mobileApiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith('http') ? path : `${BACKEND_API_URL}${path}`;
  const token = await getSessionToken();
  const deviceId = await getOrCreateDeviceId();

  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('X-Device-Id', deviceId);

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  let data: any;
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg =
      data?.detail || data?.message || `API error (${response.status})`;
    throw new Error(errorMsg);
  }

  return data;
}
