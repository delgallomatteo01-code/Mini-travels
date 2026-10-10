import type { SiteAssetKind } from "../../shared/site-settings";

export const UNAUTHORIZED_EVENT = "me-viaggi:unauthorized";

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: unknown = null) {
    super(message);
  }
}

/** fetch() for the API: never cached, errors as ApiError, 401 broadcasts a logout. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<{ status: number; data: T }> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init, headers });
  let data: unknown = null;
  try { data = await response.json(); } catch { /* empty or non JSON body */ }
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!response.ok && response.status !== 409) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `Errore ${response.status}`;
    throw new ApiError(message, response.status, data);
  }
  return { status: response.status, data: data as T };
}

export function siteAssetUrl(kind: SiteAssetKind | "icon-192" | "icon-512", version: number) {
  return `/api/site-assets?kind=${encodeURIComponent(kind)}&v=${version}`;
}

export function ticketUrl(key: string) {
  return `/api/tickets?key=${encodeURIComponent(key)}`;
}
