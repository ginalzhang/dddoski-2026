// Route-handler helpers: session cookie, per-session rate limit, admin auth, JSON helpers.
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadConfig } from "./config";
import { getOrCreateSession, type Ctx, type Result } from "./game";
import { getStore } from "./store";
import type { SessionRow } from "./store";

export const COOKIE = "sg_sid";

export function makeCtx(): Ctx {
  return { store: getStore(), config: loadConfig(), now: Date.now(), rng: Math.random };
}

const G = globalThis as unknown as { __sgRate?: Map<string, number[]> };
function rateLimited(key: string, max: number, windowMs: number, now: number): boolean {
  const m = (G.__sgRate ??= new Map<string, number[]>());
  const arr = (m.get(key) ?? []).filter((t: number) => now - t < windowMs);
  arr.push(now);
  m.set(key, arr);
  return arr.length > max;
}

/** Resolve (or create) the session, apply the rate limit, run `fn`, and set the cookie. */
export async function withSession(fn: (ctx: Ctx, s: SessionRow) => Result | Promise<Result>): Promise<NextResponse> {
  const ctx = makeCtx();
  const jar = await cookies();
  const { session, created } = getOrCreateSession(ctx, jar.get(COOKIE)?.value);
  if (created) jar.set(COOKIE, session.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: process.env.NODE_ENV === "production" });
  if (rateLimited(session.id, ctx.config.rateLimitMax, ctx.config.rateLimitWindowMs, ctx.now)) {
    return NextResponse.json({ error: "RateLimited" }, { status: 429, headers: { "retry-after": "5" } });
  }
  const r = await fn(ctx, session);
  return NextResponse.json(r.body, { status: r.status || 200, headers: { "cache-control": "no-store" } });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const j = await req.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Admin auth: header x-admin-password must equal ADMIN_PASSWORD. Unset -> admin disabled (503). */
export function adminGuard(req: Request): NextResponse | null {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return NextResponse.json({ error: "AdminDisabled", message: "set ADMIN_PASSWORD" }, { status: 503 });
  if (req.headers.get("x-admin-password") !== pw) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
