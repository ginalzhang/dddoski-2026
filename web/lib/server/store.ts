// In-memory store mirroring db/schema.sql tables. Singleton on globalThis (survives Next dev HMR).
// Optional JSON persistence to .data/store.json when STORE_PERSIST=1 (debounced).
// A Postgres adapter is NOT implemented; db/schema.sql documents the intended schema + invariants.
// All game mutations are synchronous, so each request's read-modify-write is effectively a transaction
// in a single Node process (this is what makes credit decrement race-free here).
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extractYouTubeId, validateLinkInput, validateQuiz, type LinkInput } from "./validation";

export interface LinkRow {
  id: string;
  kind: "fun" | "edu";
  video_id: string;
  url: string;
  title: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  active: boolean;
  embeddable: boolean | null;
  duration_s: number | null;
  order_hint: number;
  created_at: number;
  updated_at: number;
  comment?: string;
  has_quiz: boolean; // false for fun links loaded without a quiz
}

export interface SessionRow {
  id: string;
  user_id: string | null;
  created_at: number;
  consecutive_fun_fails: number;
  study_hall: boolean;
  study_required: number;
  study_completed: number;
  study_link_id: string | null; // current edu reel (Study Hall or voluntary)
  study_attempt: number; // 1 | 2
  study_reels_this_visit: number;
  credits: number;
  credits_earned_today: number;
  credits_day: string | null;
  credits_earned_total: number;
  credits_spent_total: number;
  credits_enabled: boolean;
  topics: string[];
  resume_after_video_id: string | null;
  pending_quiz_id: string | null;
  unplayable: string[]; // per-session unplayable video ids / link ids
  stats: { funPassed: number; funFailed: number; eduPassed: number; eduFailed: number };
}

export interface QuizRow {
  id: string;
  session_id: string;
  link_id: string | null;
  video_id: string;
  kind: "fun" | "edu";
  mode: "fun" | "studyHall" | "voluntary";
  question: string;
  options: string[]; // shuffled snapshot
  correct_index: number; // into shuffled options
  explanation: string; // snapshot
  created_at: number;
  expires_at: number;
  answered_at: number | null;
  answer_index: number | null;
  correct: boolean | null;
  attempt: number;
  abandoned?: boolean;
  result?: unknown; // stored response for idempotent grading
}

export interface LinkView { session_id: string; link_id: string; last_seen_at: number; times_seen: number; credit_earned_at: number | null }
export interface PassRow { session_id: string; video_id: string; expires_at: number }
export interface SpendRow { day: string; apify_usd: number; llm_usd: number; quizzes: number }
export interface VideoRow { video_id: string; title?: string; transcript_text: string | null; transcript_lang: string | null; transcript_auto: boolean | null; transcript_status: string; fetched_at: number }

export interface StoreData {
  links: Record<string, LinkRow>;
  sessions: Record<string, SessionRow>;
  quizzes: Record<string, QuizRow>;
  link_views: Record<string, LinkView>; // key `${sid}:${linkId}`
  passes: Record<string, PassRow>; // key `${sid}:${videoId}`
  spend: Record<string, SpendRow>;
  served: Record<string, number>; // key `${sid}:${videoId}` -> ms when served (wall-clock forgery check)
  videos: Record<string, VideoRow>;
}

export class Store {
  data: StoreData;
  private persistPath: string | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextOrder = 0;

  constructor(data?: Partial<StoreData>, persistPath: string | null = null) {
    this.data = { links: {}, sessions: {}, quizzes: {}, link_views: {}, passes: {}, spend: {}, served: {}, videos: {}, ...data };
    this.persistPath = persistPath;
    this.nextOrder = Object.values(this.data.links).reduce((m, l) => Math.max(m, l.order_hint + 1), 0);
  }

  touch() {
    if (!this.persistPath) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify(this.data));
  }

  findLink(kind: "fun" | "edu", videoId: string): LinkRow | undefined {
    return Object.values(this.data.links).find((l) => l.kind === kind && l.video_id === videoId);
  }

  /** Insert or update (by kind+video_id). */
  upsertLink(input: LinkInput & { has_quiz?: boolean }, now = Date.now()): LinkRow {
    const existing = this.findLink(input.kind, input.video_id);
    if (existing) {
      Object.assign(existing, { ...input, active: input.active ?? existing.active, updated_at: now, has_quiz: input.has_quiz ?? true });
      this.touch();
      return existing;
    }
    const row: LinkRow = {
      id: randomUUID(),
      kind: input.kind,
      video_id: input.video_id,
      url: input.url,
      title: input.title,
      topic: input.topic,
      difficulty: input.difficulty,
      question: input.question,
      options: input.options,
      correct_index: input.correct_index,
      explanation: input.explanation,
      active: input.active ?? true,
      embeddable: input.embeddable ?? null,
      duration_s: input.duration_s ?? null,
      order_hint: this.nextOrder++,
      created_at: now,
      updated_at: now,
      comment: input.comment,
      has_quiz: input.has_quiz ?? true,
    };
    this.data.links[row.id] = row;
    this.touch();
    return row;
  }

  getCachedTranscript(videoId: string): VideoRow | null {
    const v = this.data.videos[videoId];
    return v && v.transcript_text ? v : null;
  }
}

// ---------- lenient loaders ----------

function readJson(p: string): unknown {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.warn(`[store] could not read ${p}:`, (e as Error).message);
    return null;
  }
}

/** Accepts SeedLink objects, plain URL/ID strings, or loose objects ({url|link|video_id|videoId|id, title?, ...}). */
export function normalizeLooseLink(item: unknown, kind: "fun" | "edu"): (LinkInput & { has_quiz: boolean }) | null {
  const o: Record<string, unknown> = typeof item === "string" ? { url: item } : item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const src = [o.video_id, o.videoId, o.url, o.link, o.id].find((x) => typeof x === "string" && extractYouTubeId(x));
  const vid = extractYouTubeId(src as string | undefined);
  if (!vid) return null;
  const k = o.kind === "fun" || o.kind === "edu" ? o.kind : kind;
  const ciRaw = o.correct_index ?? o.correctIndex ?? o.answer;
  const options = Array.isArray(o.options) ? o.options.map((x) => String(x)) : [];
  let ci = typeof ciRaw === "number" ? ciRaw : typeof ciRaw === "string" && /^\d+$/.test(ciRaw) ? Number(ciRaw) : typeof ciRaw === "string" ? options.indexOf(ciRaw) : -1;
  if (!Number.isInteger(ci)) ci = -1;
  const explanation = typeof o.explanation === "string" && o.explanation.trim() ? o.explanation : k === "fun" && o.question ? "That's the answer." : (o.explanation as string) ?? "";
  const base = {
    kind: k,
    video_id: vid,
    url: typeof o.url === "string" ? o.url : `https://www.youtube.com/shorts/${vid}`,
    title: typeof o.title === "string" && o.title.trim() ? o.title : `Video ${vid}`,
    topic: typeof o.topic === "string" && o.topic ? o.topic.toLowerCase() : k === "edu" ? "math" : "fun",
    difficulty: ([1, 2, 3].includes(Number(o.difficulty)) ? Number(o.difficulty) : 1) as 1 | 2 | 3,
    duration_s: typeof o.duration_s === "number" ? o.duration_s : null,
    embeddable: typeof o.embeddable === "boolean" ? o.embeddable : null,
    comment: typeof o.comment === "string" ? o.comment : undefined,
  };
  const quizErr = validateQuiz({ question: o.question, options, correct_index: ci, explanation });
  if (!quizErr) {
    const full = validateLinkInput({ ...base, question: o.question, options, correct_index: ci, explanation, active: o.active === undefined ? true : !!o.active });
    if (full.ok) return { ...full.value, has_quiz: true };
  }
  // No valid quiz: fun links stay active (quiz via generated mode or auto-pass); edu links are inactive.
  return {
    ...base,
    question: "",
    options: [],
    correct_index: 0,
    explanation: "",
    active: k === "fun" ? o.active === undefined ? true : !!o.active : false,
    comment: base.comment ?? (k === "edu" ? `inactive: no valid quiz (${quizErr})` : undefined),
    has_quiz: false,
  };
}

export function loadLinksFile(store: Store, p: string, kind: "fun" | "edu", onlyNew = false): number {
  const raw = readJson(p);
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { links?: unknown }).links) ? (raw as { links: unknown[] }).links : [];
  let n = 0;
  for (const item of arr) {
    const li = normalizeLooseLink(item, kind);
    if (!li) continue;
    if (onlyNew && store.findLink(li.kind, li.video_id)) continue;
    store.upsertLink(li);
    n++;
  }
  return n;
}

/** Transcripts: {id: "text"} | {id: {text|transcript, lang?, isAutoGenerated?}} | [{videoId|video_id|id|url, transcript|text, ...}] */
export function loadTranscriptsFile(store: Store, p: string): number {
  const raw = readJson(p);
  if (!raw) return 0;
  const entries: [string, unknown][] = Array.isArray(raw)
    ? raw.map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return [String(o.videoId ?? o.video_id ?? o.id ?? o.url ?? ""), o] as [string, unknown];
      })
    : Object.entries(raw as Record<string, unknown>);
  let n = 0;
  for (const [key, val] of entries) {
    const vid = extractYouTubeId(key);
    if (!vid) continue;
    const o = typeof val === "string" ? { text: val } : ((val ?? {}) as Record<string, unknown>);
    const text = o.text ?? o.transcript ?? o.transcript_text;
    const t = Array.isArray(text) ? text.map((x) => (typeof x === "string" ? x : (x as { text?: string })?.text ?? "")).join(" ") : typeof text === "string" ? text : null;
    if (!t) continue;
    store.data.videos[vid] = {
      video_id: vid,
      title: typeof o.title === "string" ? o.title : undefined,
      transcript_text: t,
      transcript_lang: typeof (o.lang ?? o.language) === "string" ? String(o.lang ?? o.language) : null,
      transcript_auto: typeof (o.isAutoGenerated ?? o.auto) === "boolean" ? Boolean(o.isAutoGenerated ?? o.auto) : null,
      transcript_status: "ok",
      fetched_at: Date.now(),
    };
    n++;
  }
  return n;
}

export function webRoot(): string {
  return process.cwd();
}

export function loadAllSources(store: Store, root = webRoot(), env: Record<string, string | undefined> = process.env, onlyNew = false) {
  const r = (p: string) => (path.isAbsolute(p) ? p : path.join(root, p));
  return {
    seedEdu: loadLinksFile(store, r("seed/edu-links.json"), "edu", onlyNew),
    seedFun: loadLinksFile(store, r("seed/fun-links.json"), "fun", onlyNew),
    dataFun: loadLinksFile(store, r(env.FUN_LINKS_PATH || "data/fun-links.json"), "fun", onlyNew),
    dataEdu: loadLinksFile(store, r(env.EDU_LINKS_PATH || "data/edu-links.json"), "edu", onlyNew),
    transcripts: loadTranscriptsFile(store, r(env.TRANSCRIPTS_PATH || "data/transcripts.json")),
  };
}

const G = globalThis as unknown as { __sgStore?: Store };

export function getStore(): Store {
  if (G.__sgStore) return G.__sgStore;
  const persist = process.env.STORE_PERSIST === "1";
  const file = path.join(webRoot(), ".data/store.json");
  let store: Store;
  const saved = persist ? (readJson(file) as Partial<StoreData> | null) : null;
  if (saved) {
    store = new Store(saved, file);
    loadAllSources(store, webRoot(), process.env, true); // add links that appeared in source files since
  } else {
    store = new Store(undefined, persist ? file : null);
    loadAllSources(store);
  }
  G.__sgStore = store;
  return store;
}

export function getCachedTranscript(videoId: string) {
  return getStore().getCachedTranscript(videoId);
}
