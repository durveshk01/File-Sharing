import { API } from "../api";

export const API_URL = API;
let accountId: string | null = null;
const ACCOUNT_KEY = "secureshare_current_account";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export function setBrowserAccount(account: { id: string }) {
  accountId = account.id;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(ACCOUNT_KEY, account.id);
      localStorage.removeItem("secureshare_token");
    } catch { /* Cookie sessions remain usable when browser storage is restricted. */ }
  }
}

export function getBrowserAccountId(): string | null {
  if (typeof window !== "undefined") {
    try { return sessionStorage.getItem(ACCOUNT_KEY) || accountId; } catch { /* Use memory. */ }
  }
  return accountId;
}

export function clearBrowserSession() {
  accountId = null;
  if (typeof window !== "undefined") {
    try {
      sessionStorage.removeItem(ACCOUNT_KEY);
      localStorage.removeItem("secureshare_token");
    } catch { /* Private file keys are retained for recovery. */ }
  }
}

export async function requireBrowserAccount(): Promise<string> {
  const account = await apiRequest<{ id: string }>("/api/auth/me");
  return account.id;
}

export async function responseError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null);
  const detail = body?.detail || body?.message;
  const message = errorMessage(detail, response.status);
  return new ApiError(response.status, message);
}

function errorMessage(detail: unknown, status: number): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => typeof item?.msg === 'string' ? item.msg : '').filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return `Request failed (${status})`;
}

/** Browser authentication stays in the same-origin HttpOnly session cookie. */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  if (!path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("API requests must use a same-origin /api/ path");
  }
  const response = await fetch(`${API}${path}`, { ...options, credentials: "same-origin", cache: "no-store" });
  if (response.status === 401 && !path.startsWith("/api/auth/login")) {
    clearBrowserSession();
    if (typeof window !== "undefined") window.dispatchEvent(new Event("secureshare:session-expired"));
  }
  return response;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(path, options);

  if (response.status === 204) {
    return {} as T;
  }

  let data: any;
  const contentType = response.headers.get("content-type");
  if (contentType && contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const detail = data?.detail || data?.message;
    throw new ApiError(response.status, errorMessage(detail, response.status));
  }
  if (path.startsWith("/api/auth/") && typeof data?.id === "string") setBrowserAccount(data);
  return data;
}
