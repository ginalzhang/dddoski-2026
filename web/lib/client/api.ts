"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StateResponse } from "@/lib/types";

export interface ApiResult<T = any> {
  ok: boolean;
  status: number;
  data: T;
}

export async function api<T = any>(
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export const STATE_EVENT = "sg:state";

/** Fetch /api/state and broadcast to listeners (header badge etc.). */
export async function refreshState(): Promise<StateResponse | null> {
  try {
    const r = await api<StateResponse>("/api/state");
    if (r.ok && r.data) {
      window.dispatchEvent(new CustomEvent(STATE_EVENT, { detail: r.data }));
      return r.data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function adminHeaders(): Record<string, string> {
  const pw = typeof window !== "undefined" ? sessionStorage.getItem("sg_admin_pw") ?? "" : "";
  return { "x-admin-password": pw };
}
