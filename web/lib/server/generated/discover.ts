// Fun-feed discovery via Apify Shorts scrapers. Input field names verified 2026-10-16 from each actor's .md page.
import type { FunItem } from "@/lib/types";
import { ApifyError, runActor, SpendCapError, type FetchLike } from "./apify";
import { overCap } from "./spend";
import { prefetchTranscripts } from "./transcripts";

export const ACTORS = {
  channel: "streamers~youtube-shorts-scraper",
  keyword: "makework36~youtube-shorts-scraper",
  hashtag: "scrapestorm~youtube-hashtag-shorts-videos-scraper-all-in-one",
} as const;

export type SourceKind = keyof typeof ACTORS;
export interface Source {
  kind: SourceKind;
  value: string;
}

export const PAGE_SIZE = 3;
const PER_SOURCE = 20;
const CACHE_TTL_MS = 30 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseSources(raw: string | undefined): Source[] {
  if (!raw) return [];
  const out: Source[] = [];
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const kind = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (value && (kind === "channel" || kind === "keyword" || kind === "hashtag")) out.push({ kind, value });
  }
  return out;
}

function inputFor(s: Source): unknown {
  switch (s.kind) {
    case "channel":
      // streamers: channel username WITHOUT "@", or a channel URL.
      return { channels: [s.value.replace(/^@/, "")], maxResultsShorts: PER_SOURCE, sortChannelShortsBy: "NEWEST" };
    case "keyword":
      return { searchQueries: [s.value], maxResultsPerQuery: PER_SOURCE, onlyShortsFilter: true };
    case "hashtag":
      return { hashtagKeywords: [s.value.replace(/^#/, "")], contentType: "Shorts", maxItemsPerKeyword: PER_SOURCE };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function idFromUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  const m = u.match(/(?:shorts\/|v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m?.[1];
}

/** Normalises the three actors' differing item shapes. Error items (with `error`) are dropped. */
export function normalizeItem(raw: Record<string, unknown>): (FunItem & { channel?: string }) | null {
  if (raw.error) return null;
  const url = str(raw.url) ?? str(raw["Short/Video URL"]);
  const id = str(raw.videoId) ?? str(raw.id) ?? str(raw["Short/Video ID"]) ?? idFromUrl(url);
  if (!id || !ID_RE.test(id)) return null;
  const title = str(raw.title) ?? str(raw.Title) ?? "";
  const channel = str(raw.channelName);
  return { videoId: id, title, ...(channel ? { channel } : {}) };
}

interface FeedCache {
  items: (FunItem & { channel?: string })[];
  fetched_at: number;
}
let cache: FeedCache | null = null;
export const metaById = new Map<string, { title?: string; channel?: string }>();

export function __resetDiscovery() {
  cache = null;
  metaById.clear();
}

export interface DiscoverDeps {
  fetch?: FetchLike;
  now?: () => number;
  /** called with ids that should be transcript-prefetched in the background */
  onPage?: (ids: string[]) => void;
}

async function refresh(deps: DiscoverDeps): Promise<FeedCache> {
  const sources = parseSources(process.env.FUN_SOURCES);
  if (!sources.length) throw new ApifyError("config", "FUN_SOURCES is empty");
  if (overCap()) throw new SpendCapError();
  const maxCharge = Number(process.env.APIFY_DISCOVERY_MAX_USD) || 0.25;
  const results = await Promise.allSettled(
    sources.map((s) => runActor<Record<string, unknown>>(ACTORS[s.kind], inputFor(s), { fetch: deps.fetch, maxChargeUsd: maxCharge })),
  );
  const seen = new Set<string>();
  const items: FeedCache["items"] = [];
  // Interleave sources round-robin so one source doesn't dominate the first pages.
  const lists = results.map((r) => (r.status === "fulfilled" ? r.value.map(normalizeItem).filter((x) => x !== null) : []));
  const maxLen = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) {
    for (const l of lists) {
      const it = l[i];
      if (it && !seen.has(it.videoId)) {
        seen.add(it.videoId);
        items.push(it);
      }
    }
  }
  if (!items.length) {
    const firstErr = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (firstErr) throw firstErr.reason;
    throw new ApifyError("blocked", "All discovery sources returned no usable items");
  }
  for (const it of items) metaById.set(it.videoId, { title: it.title, channel: it.channel });
  return { items, fetched_at: (deps.now ?? Date.now)() };
}

export async function discoverFunFeed(
  cursor: string | null,
  deps: DiscoverDeps = {},
): Promise<{ items: FunItem[]; cursor: string | null }> {
  const now = (deps.now ?? Date.now)();
  let offset = cursor ? Number.parseInt(cursor, 10) : 0;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  const stale = !cache || now - cache.fetched_at > CACHE_TTL_MS;
  if (stale) {
    try {
      const fresh = await refresh(deps);
      // Keep already-served order stable: append new unique IDs after existing ones.
      if (cache) {
        const have = new Set(cache.items.map((i) => i.videoId));
        cache = { items: [...cache.items, ...fresh.items.filter((i) => !have.has(i.videoId))], fetched_at: fresh.fetched_at };
      } else cache = fresh;
    } catch (e) {
      if (!cache) throw e; // nothing to serve
    }
  }
  const all = cache!.items;
  const page = all.slice(offset, offset + PAGE_SIZE);
  const next = offset + PAGE_SIZE < all.length ? String(offset + PAGE_SIZE) : null;
  const onPage = deps.onPage ?? ((ids: string[]) => void prefetchTranscripts(ids, { fetch: deps.fetch }));
  onPage(all.slice(offset, offset + PAGE_SIZE * 2).map((i) => i.videoId));
  return { items: page.map(({ videoId, title }) => ({ videoId, title })), cursor: next };
}
