// Thin Apify run-sync client. All network goes through an injectable fetch.
import { recordSpend } from "./spend";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type ApifyErrorKind = "payment" | "timeout" | "blocked" | "auth" | "rate_limit" | "error" | "config";

export class ApifyError extends Error {
  constructor(
    public kind: ApifyErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

export class SpendCapError extends Error {
  constructor(message = "Daily spend cap reached") {
    super(message);
    this.name = "SpendCapError";
  }
}

export const APIFY_TIMEOUT_MS = 25_000;

export interface RunActorOpts {
  fetch?: FetchLike;
  token?: string;
  maxChargeUsd: number;
  timeoutMs?: number;
}

/** POST run-sync-get-dataset-items. Records maxChargeUsd as a conservative upper-bound spend. */
export async function runActor<T = Record<string, unknown>>(
  actor: string,
  input: unknown,
  opts: RunActorOpts,
): Promise<T[]> {
  const token = opts.token ?? process.env.APIFY_TOKEN;
  if (!token) throw new ApifyError("config", "APIFY_TOKEN not set");
  const f = opts.fetch ?? (globalThis.fetch as FetchLike);
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?maxTotalChargeUsd=${opts.maxChargeUsd}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? APIFY_TIMEOUT_MS);
  let res: Response;
  try {
    res = await f(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted || (e as Error)?.name === "AbortError") {
      throw new ApifyError("timeout", `${actor}: timed out after ${opts.timeoutMs ?? APIFY_TIMEOUT_MS}ms`);
    }
    throw new ApifyError("error", `${actor}: network error: ${(e as Error)?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
  // A run was attempted; count the cap as spent (we can't see the real charge from this endpoint).
  recordSpend({ apifyUsd: opts.maxChargeUsd });
  if (!res.ok) {
    const s = res.status;
    const kind: ApifyErrorKind =
      s === 402 ? "payment" : s === 408 ? "timeout" : s === 401 || s === 403 ? "auth" : s === 429 ? "rate_limit" : "error";
    throw new ApifyError(kind, `${actor}: HTTP ${s}`, s);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApifyError("error", `${actor}: invalid JSON response`);
  }
  if (!Array.isArray(data)) throw new ApifyError("error", `${actor}: expected array of dataset items`);
  return data as T[];
}
