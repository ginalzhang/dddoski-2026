// Admin operations over the store. Editing links never touches quiz rows (quizzes hold snapshots).
import type { LinkRow, Store } from "./store";
import { parseLinksCsv, validateLinkInput } from "./validation";

type R = { status: number; body: Record<string, unknown> };

export function adminListLinks(store: Store): LinkRow[] {
  return Object.values(store.data.links).sort((a, b) => a.kind.localeCompare(b.kind) || a.order_hint - b.order_hint);
}

export function adminCreateLink(store: Store, raw: Record<string, unknown>): R {
  const v = validateLinkInput(raw);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  return { status: 201, body: { link: store.upsertLink(v.value) } };
}

export function adminUpdateLink(store: Store, id: string, patch: Record<string, unknown>): R {
  const cur = store.data.links[id];
  if (!cur) return { status: 404, body: { error: "NotFound" } };
  const merged = { ...cur, ...patch, video_id: patch.video_id ?? patch.url ?? cur.video_id };
  const v = validateLinkInput(merged);
  if (!v.ok) return { status: 400, body: { error: v.error } };
  const clash = store.findLink(v.value.kind, v.value.video_id);
  if (clash && clash.id !== id) return { status: 409, body: { error: "duplicate video for this kind" } };
  Object.assign(cur, v.value, {
    active: typeof patch.active === "boolean" ? patch.active : cur.active,
    embeddable: patch.embeddable === undefined ? cur.embeddable : v.value.embeddable,
    duration_s: patch.duration_s === undefined ? cur.duration_s : v.value.duration_s,
    has_quiz: true,
    updated_at: Date.now(),
  });
  store.touch();
  return { status: 200, body: { link: cur } };
}

export function adminDeactivateLink(store: Store, id: string): R {
  const cur = store.data.links[id];
  if (!cur) return { status: 404, body: { error: "NotFound" } };
  cur.active = false;
  cur.updated_at = Date.now();
  store.touch();
  return { status: 200, body: { link: cur } };
}

export function adminImportCsv(store: Store, csv: string) {
  const { valid, rejected } = parseLinksCsv(csv);
  for (const v of valid) store.upsertLink(v.value);
  return { imported: valid.length, rejected };
}

/** oEmbed: 200 = embeddable, 401/403 = embedding disabled, 404 = gone/private. */
export async function verifyEmbeddable(store: Store, id: string, fetchImpl: typeof fetch = fetch): Promise<R> {
  const link = store.data.links[id];
  if (!link) return { status: 404, body: { error: "NotFound" } };
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${link.video_id}`)}&format=json`;
  let status: number;
  try {
    status = (await fetchImpl(url, { signal: AbortSignal.timeout(8000) })).status;
  } catch (e) {
    return { status: 502, body: { error: "VerifyFailed", message: (e as Error).message } };
  }
  const result = status === 200 ? "embeddable" : status === 401 || status === 403 ? "notEmbeddable" : status === 404 ? "gone" : "unknown";
  if (result === "embeddable") link.embeddable = true;
  if (result === "notEmbeddable" || result === "gone") link.embeddable = false;
  link.updated_at = Date.now();
  store.touch();
  return { status: 200, body: { id, videoId: link.video_id, httpStatus: status, result, embeddable: link.embeddable } };
}
