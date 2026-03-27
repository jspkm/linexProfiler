import { CLOUD_FUNCTION_URL } from "@/app/components/theme";
import type { ApiRecord } from "./types";

export { CLOUD_FUNCTION_URL };
export const DATASETS_URL = `${CLOUD_FUNCTION_URL}/list_portfolio_datasets`;

export async function fetchJson<T = ApiRecord>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error((errData as ApiRecord).error || `Request failed (${res.status})`);
  }
  return res.json();
}

export async function postJson<T = ApiRecord>(url: string, body: ApiRecord, init?: RequestInit): Promise<T> {
  return fetchJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

export async function deleteJson<T = ApiRecord>(url: string, init?: RequestInit): Promise<T> {
  return fetchJson<T>(url, { method: "DELETE", ...init });
}

/** Check if an error is an AbortError (from AbortController). */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
