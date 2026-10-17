// Pure game logic over a Store. Every function is synchronous; `ctx.now`/`ctx.rng` are injectable for tests.
import { randomUUID } from "node:crypto";
import type { EduReel, FunItem, Phase, PublicQuiz, StateResponse, StudyState } from "@/lib/types";
import type { Config } from "./config";
import type { LinkRow, QuizRow, SessionRow, Store } from "./store";

export interface Ctx { store: Store; config: Config; now: number; rng: () => number }
export interface Result { status: number; body: Record<string, unknown> }

const DAY = 86_400_000;
const ok = (body: Record<string, unknown>): Result => ({ status: 200, body });
const err = (status: number, body: Record<string, unknown>): Result => ({ status, body });

// ---------- sessions ----------

export function createSession(ctx: Ctx): SessionRow {
  const s: SessionRow = {
    id: randomUUID(),
    user_id: null,
    created_at: ctx.now,
    consecutive_fun_fails: 0,
    study_hall: false,
    study_required: 0,
    study_completed: 0,
    study_link_id: null,
    study_attempt: 1,
    study_reels_this_visit: 0,
    credits: 0,
    credits_earned_today: 0,
    credits_day: null,
    credits_earned_total: 0,
    credits_spent_total: 0,
    credits_enabled: true,
    topics: [...ctx.config.defaultTopics],
    resume_after_video_id: null,
    pending_quiz_id: null,
    unplayable: [],
    stats: { funPassed: 0, funFailed: 0, eduPassed: 0, eduFailed: 0 },
  };
  ctx.store.data.sessions[s.id] = s;
  ctx.store.touch();
  return s;
}

export function getOrCreateSession(ctx: Ctx, sid: string | undefined | null): { session: SessionRow; created: boolean } {
  const s = sid ? ctx.store.data.sessions[sid] : undefined;
  if (s) return { session: s, created: false };
  return { session: createSession(ctx), created: true };
}

function pendingQuiz(ctx: Ctx, s: SessionRow): QuizRow | null {
  const q = s.pending_quiz_id ? ctx.store.data.quizzes[s.pending_quiz_id] : undefined;
  if (!q || q.answered_at !== null) return null;
  return q;
}

function abandon(ctx: Ctx, s: SessionRow, q: QuizRow) {
  q.answered_at = ctx.now;
  q.correct = false;
  q.abandoned = true;
  if (s.pending_quiz_id === q.id) s.pending_quiz_id = null;
}

/** Fun quizzes past expiry are graded wrong automatically (enters Study Hall). */
export function settleExpired(ctx: Ctx, s: SessionRow) {
  const q = pendingQuiz(ctx, s);
  if (q && q.kind === "fun" && ctx.now > q.expires_at) gradeFun(ctx, s, q, null);
}

export function phaseOf(ctx: Ctx, s: SessionRow): Phase {
  if (s.study_hall) return "studyHall";
  const q = pendingQuiz(ctx, s);
  if (q?.kind === "fun") return "quizOwed";
  if (q?.mode === "voluntary") return "study";
  return "free";
}

function reelOf(l: LinkRow | undefined | null): EduReel | null {
  return l ? { linkId: l.id, videoId: l.video_id, title: l.title, topic: l.topic } : null;
}

export function studyState(ctx: Ctx, s: SessionRow): StudyState {
  if (!s.study_hall) return { required: s.study_required, completed: s.study_completed, reel: null };
  return {
    required: s.study_required,
    completed: s.study_completed,
    reel: reelOf(s.study_link_id ? ctx.store.data.links[s.study_link_id] : null),
    attempt: s.study_attempt,
  };
}

export function publicQuiz(q: QuizRow): PublicQuiz {
  return { quizId: q.id, question: q.question, options: q.options, expiresAt: new Date(q.expires_at).toISOString(), attempt: q.attempt, kind: q.kind };
}

export function getState(ctx: Ctx, s: SessionRow): StateResponse {
  settleExpired(ctx, s);
  rollCreditDay(ctx, s);
  const q = pendingQuiz(ctx, s);
  return {
    phase: phaseOf(ctx, s),
    study: studyState(ctx, s),
    credits: s.credits,
    creditsEnabled: s.credits_enabled,
    pendingQuiz: q ? publicQuiz(q) : null,
    resumeAfterVideoId: s.resume_after_video_id,
  };
}

function blocked(ctx: Ctx, s: SessionRow): Result | null {
  settleExpired(ctx, s);
  const phase = phaseOf(ctx, s);
  if (phase === "studyHall") return err(409, { error: "StudyHall", phase, study: studyState(ctx, s) });
  return null;
}

// ---------- helpers ----------

export function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle options; returns snapshot with the correct index remapped. Avoids reusing `avoid` order when possible. */
export function shuffledSnapshot(options: string[], correct: number, rng: () => number, avoid?: string[]): { options: string[]; correct_index: number } {
  const idx = options.map((_, i) => i);
  let order = shuffle(idx, rng);
  for (let t = 0; avoid && t < 5 && order.map((i) => options[i]).join("\u0000") === avoid.join("\u0000"); t++) order = shuffle(idx, rng);
  return { options: order.map((i) => options[i]), correct_index: order.indexOf(correct) };
}

export function requiredWatchSeconds(duration: number, fraction: number): number {
  if (!(duration > 0)) return 10; // unknown duration: require 10s of play
  return Math.max(fraction * duration, Math.min(10, duration));
}

const servedKey = (s: SessionRow, vid: string) => `${s.id}:${vid}`;
export function markServed(ctx: Ctx, s: SessionRow, videoId: string, reset = false) {
  const k = servedKey(s, videoId);
  if (reset || ctx.store.data.served[k] === undefined) ctx.store.data.served[k] = ctx.now;
}

function checkWatch(ctx: Ctx, s: SessionRow, videoId: string, watched: unknown, clientDuration: unknown, storedDuration: number | null): Result | null {
  const w = Number(watched);
  if (!Number.isFinite(w) || w < 0) return err(400, { error: "BadRequest", message: "watchedSeconds required" });
  const servedAt = ctx.store.data.served[servedKey(s, videoId)];
  if (servedAt === undefined) return err(400, { error: "NotServed", message: "video was not served to this session" });
  const elapsed = (ctx.now - servedAt) / 1000;
  if (w > elapsed + ctx.config.wallclockSlackSec) return err(400, { error: "WatchForged", message: "watchedSeconds exceeds wall-clock time", elapsed });
  const d = storedDuration && storedDuration > 0 ? storedDuration : Number(clientDuration);
  const need = requiredWatchSeconds(Math.min(Number.isFinite(d) ? d : 0, 600), ctx.config.minWatchFraction);
  if (w + 1e-9 < need) return err(400, { error: "MinWatch", requiredSeconds: Math.ceil(need * 10) / 10, watchedSeconds: w });
  return null;
}

function newQuiz(ctx: Ctx, s: SessionRow, q: Omit<QuizRow, "id" | "session_id" | "created_at" | "expires_at" | "answered_at" | "answer_index" | "correct">): QuizRow {
  const row: QuizRow = { ...q, id: randomUUID(), session_id: s.id, created_at: ctx.now, expires_at: ctx.now + ctx.config.answerTimeoutSec * 1000, answered_at: null, answer_index: null, correct: null };
  ctx.store.data.quizzes[row.id] = row;
  s.pending_quiz_id = row.id;
  ctx.store.touch();
  return row;
}

function hasPass(ctx: Ctx, s: SessionRow, videoId: string): boolean {
  const p = ctx.store.data.passes[`${s.id}:${videoId}`];
  return !!p && p.expires_at > ctx.now;
}

function addPass(ctx: Ctx, s: SessionRow, videoId: string) {
  ctx.store.data.passes[`${s.id}:${videoId}`] = { session_id: s.id, video_id: videoId, expires_at: ctx.now + ctx.config.passDays * DAY };
}

function dayOf(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}
function rollCreditDay(ctx: Ctx, s: SessionRow) {
  const d = dayOf(ctx.now);
  if (s.credits_day !== d) { s.credits_day = d; s.credits_earned_today = 0; }
}

// ---------- fun feed ----------

export function curatedFunLinks(ctx: Ctx, s: SessionRow): LinkRow[] {
  return Object.values(ctx.store.data.links)
    .filter((l) => l.kind === "fun" && l.active)
    .sort((a, b) => a.order_hint - b.order_hint)
    .filter((l, i, arr) => arr.findIndex((x) => x.video_id === l.video_id) === i); // dedupe IDs
}

/** Curated feed page. cursor = index into ordered fun links; `after` = resume after this video id. */
export function feedCurated(ctx: Ctx, s: SessionRow, cursor: string | null, after?: string | null): Result {
  const b = blocked(ctx, s);
  if (b) return b;
  const all = curatedFunLinks(ctx, s);
  let idx = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
  if (after) {
    const i = all.findIndex((l) => l.video_id === after);
    idx = i >= 0 ? i + 1 : idx;
  }
  const items: FunItem[] = [];
  let i = idx;
  for (; i < all.length && items.length < 3; i++) {
    const l = all[i];
    if (l.embeddable === false || s.unplayable.includes(l.video_id)) continue;
    items.push({ videoId: l.video_id, title: l.title });
  }
  return ok(serveFeed(ctx, s, { items, cursor: i < all.length ? String(i) : null }));
}

export function serveFeed(ctx: Ctx, s: SessionRow, page: { items: FunItem[]; cursor: string | null }) {
  const items = page.items.filter((it) => !s.unplayable.includes(it.videoId)).slice(0, 3);
  for (const it of items) markServed(ctx, s, it.videoId);
  ctx.store.touch();
  return { items, cursor: page.cursor };
}

export type FunQuizContent = { question: string; options: string[]; correctIndex: number; explanation?: string } | { pass: true };

export interface FunStartInput { videoId?: unknown; direction?: unknown; watchedSeconds?: unknown; durationSeconds?: unknown }

/**
 * Start a fun quiz. Returns { needContent: true } (status 0) when no curated quiz exists and the caller
 * should obtain one from generated mode, then call again passing `content`.
 */
export function startFunQuiz(ctx: Ctx, s: SessionRow, input: FunStartInput, content?: FunQuizContent | null): Result {
  const videoId = typeof input.videoId === "string" ? input.videoId : "";
  if (!videoId) return err(400, { error: "BadRequest", message: "videoId required" });
  const b = blocked(ctx, s);
  if (b) return b;
  const direction = input.direction === "prev" ? "prev" : "next";
  const pq = pendingQuiz(ctx, s);
  if (pq?.kind === "fun") {
    if (pq.video_id === videoId) return ok({ ...publicQuiz(pq) }); // idempotent (double-click Next)
    return err(409, { error: "QuizOwed", phase: "quizOwed", study: studyState(ctx, s), pendingQuiz: publicQuiz(pq) });
  }
  if (hasPass(ctx, s, videoId)) return ok({ skipped: true, reason: "passed", direction, next: null, credits: s.credits });
  if (s.credits_enabled && s.credits > 0) {
    s.credits -= 1;
    s.credits_spent_total += 1;
    ctx.store.touch();
    return ok({ skipped: true, reason: "credit", direction, next: null, credits: s.credits });
  }
  const link = ctx.store.findLink("fun", videoId);
  const w = checkWatch(ctx, s, videoId, input.watchedSeconds, input.durationSeconds, link?.duration_s ?? null);
  if (w) return w;
  let q: { question: string; options: string[]; correctIndex: number; explanation: string } | null = null;
  if (link && link.has_quiz) q = { question: link.question, options: link.options, correctIndex: link.correct_index, explanation: link.explanation };
  else if (content && "question" in content) q = { ...content, explanation: content.explanation ?? "" };
  else if (content === undefined && ctx.config.funFeedMode === "generated") return { status: 0, body: { needContent: true } };
  if (!q) {
    // No quiz available (no curated quiz, generator unavailable or returned pass): auto-pass.
    addPass(ctx, s, videoId);
    ctx.store.touch();
    return ok({ skipped: true, reason: "noQuiz", direction, next: null, credits: s.credits });
  }
  if (pq) abandon(ctx, s, pq); // voluntary edu quiz left open
  const snap = shuffledSnapshot(q.options, q.correctIndex, ctx.rng);
  const row = newQuiz(ctx, s, { link_id: link?.id ?? null, video_id: videoId, kind: "fun", mode: "fun", question: q.question, options: snap.options, correct_index: snap.correct_index, explanation: q.explanation, attempt: 1 });
  return ok({ ...publicQuiz(row) });
}

function gradeFun(ctx: Ctx, s: SessionRow, q: QuizRow, answerIndex: number | null): Record<string, unknown> {
  const inTime = ctx.now <= q.expires_at;
  const correct = inTime && answerIndex !== null && answerIndex === q.correct_index;
  q.answered_at = ctx.now;
  q.answer_index = answerIndex;
  q.correct = correct;
  if (s.pending_quiz_id === q.id) s.pending_quiz_id = null;
  let result: Record<string, unknown>;
  if (correct) {
    addPass(ctx, s, q.video_id);
    s.consecutive_fun_fails = 0;
    s.stats.funPassed++;
    result = { correct: true, rationale: q.explanation || "Correct!", next: null };
  } else {
    s.stats.funFailed++;
    s.consecutive_fun_fails += 1;
    enterStudyHall(ctx, s, q.video_id);
    result = { correct: false, expired: !inTime, rationale: q.explanation || "Not quite.", study: studyState(ctx, s) };
  }
  q.result = result;
  ctx.store.touch();
  return result;
}

export function answerFunQuiz(ctx: Ctx, s: SessionRow, input: { quizId?: unknown; answerIndex?: unknown }): Result {
  const q = typeof input.quizId === "string" ? ctx.store.data.quizzes[input.quizId] : undefined;
  if (!q || q.session_id !== s.id || q.kind !== "fun") return err(404, { error: "NotFound" });
  if (q.answered_at !== null) return ok({ ...(q.result as Record<string, unknown>), alreadyAnswered: true });
  const ai = Number.isInteger(input.answerIndex) ? (input.answerIndex as number) : null;
  return ok(gradeFun(ctx, s, q, ai));
}

// ---------- Study Hall ----------

export function enterStudyHall(ctx: Ctx, s: SessionRow, failedVideoId: string) {
  const pq = pendingQuiz(ctx, s);
  if (pq) abandon(ctx, s, pq);
  const link = pickEduLink(ctx, s);
  s.resume_after_video_id = failedVideoId;
  if (!link) {
    // Empty edu database: never deadlock. Documented decision: Study Hall is skipped.
    s.study_hall = false;
    s.study_required = 0;
    s.study_completed = 0;
    return;
  }
  s.study_hall = true;
  s.study_required = Math.min(Math.max(1, s.consecutive_fun_fails), ctx.config.maxRequired);
  s.study_completed = 0;
  s.study_reels_this_visit = 0;
  assignReel(ctx, s, link);
}

function assignReel(ctx: Ctx, s: SessionRow, link: LinkRow) {
  s.study_link_id = link.id;
  s.study_attempt = 1;
  if (s.study_hall) s.study_reels_this_visit += 1;
  const k = `${s.id}:${link.id}`;
  const v = ctx.store.data.link_views[k];
  if (v) { v.last_seen_at = ctx.now; v.times_seen += 1; }
  else ctx.store.data.link_views[k] = { session_id: s.id, link_id: link.id, last_seen_at: ctx.now, times_seen: 1, credit_earned_at: null };
  markServed(ctx, s, link.video_id, true);
  ctx.store.touch();
}

/** Least-recently-seen edu link, preferring session topics (fallback: any topic), random tie-break, avoiding `exclude` unless it's the only one. */
export function pickEduLink(ctx: Ctx, s: SessionRow, exclude?: string | null): LinkRow | null {
  const all = Object.values(ctx.store.data.links).filter(
    (l) => l.kind === "edu" && l.active && l.has_quiz && l.embeddable !== false && !s.unplayable.includes(l.id) && !s.unplayable.includes(l.video_id),
  );
  if (!all.length) return null;
  const topical = all.filter((l) => s.topics.includes(l.topic));
  let pool = topical.length ? topical : all;
  if (exclude) {
    const without = pool.filter((l) => l.id !== exclude);
    if (without.length) pool = without;
    else {
      const anyOther = all.filter((l) => l.id !== exclude);
      if (anyOther.length) pool = anyOther;
    }
  }
  const seen = (l: LinkRow) => ctx.store.data.link_views[`${s.id}:${l.id}`]?.last_seen_at ?? -Infinity;
  const min = Math.min(...pool.map(seen));
  const ties = pool.filter((l) => seen(l) === min);
  return ties[Math.floor(ctx.rng() * ties.length)] ?? ties[0];
}

/** GET /api/study/next */
export function studyNext(ctx: Ctx, s: SessionRow): Result {
  settleExpired(ctx, s);
  if (s.study_hall) {
    let l = s.study_link_id ? ctx.store.data.links[s.study_link_id] : undefined;
    if (!l || !l.active) {
      const n = pickEduLink(ctx, s, s.study_link_id);
      if (!n) return exitStudyHall(ctx, s, { reason: "noLinks" });
      assignReel(ctx, s, n);
      l = n;
    }
    return ok({ ...reelOf(l)!, phase: "studyHall", study: studyState(ctx, s) });
  }
  const l = pickEduLink(ctx, s, s.study_link_id);
  if (!l) return err(404, { error: "NoEduLinks" });
  assignReel(ctx, s, l);
  return ok({ ...reelOf(l)!, phase: phaseOf(ctx, s), study: studyState(ctx, s) });
}

function exitStudyHall(ctx: Ctx, s: SessionRow, extra: Record<string, unknown> = {}): Result {
  s.study_hall = false;
  s.study_link_id = null;
  ctx.store.touch();
  return ok({ next: "resume", resumeAfterVideoId: s.resume_after_video_id, phase: phaseOf(ctx, s), study: studyState(ctx, s), ...extra });
}

export function startStudyQuiz(ctx: Ctx, s: SessionRow, input: { linkId?: unknown; watchedSeconds?: unknown; durationSeconds?: unknown }): Result {
  settleExpired(ctx, s);
  const link = typeof input.linkId === "string" ? ctx.store.data.links[input.linkId] : undefined;
  if (!link || link.kind !== "edu" || !link.has_quiz) return err(404, { error: "NotFound" });
  const pq = pendingQuiz(ctx, s);
  if (!s.study_hall && pq?.kind === "fun") return err(409, { error: "QuizOwed", phase: "quizOwed", study: studyState(ctx, s), pendingQuiz: publicQuiz(pq) });
  if (s.study_hall && link.id !== s.study_link_id) return err(409, { error: "WrongReel", phase: "studyHall", study: studyState(ctx, s) });
  const mode = s.study_hall ? "studyHall" : "voluntary";
  const attempt = link.id === s.study_link_id ? s.study_attempt : 1;
  if (pq && pq.kind === "edu" && pq.link_id === link.id && pq.attempt === attempt && pq.mode === mode && ctx.now <= pq.expires_at) return ok({ ...publicQuiz(pq) });
  const w = checkWatch(ctx, s, link.video_id, input.watchedSeconds, input.durationSeconds, link.duration_s);
  if (w) return w;
  if (pq) abandon(ctx, s, pq);
  if (!s.study_hall && link.id !== s.study_link_id) { s.study_link_id = link.id; s.study_attempt = 1; }
  // Attempt 2 reshuffles options (different order from attempt 1 when possible).
  const prev = Object.values(ctx.store.data.quizzes).filter((q) => q.session_id === s.id && q.link_id === link.id && q.kind === "edu").sort((a, b) => b.created_at - a.created_at)[0];
  const snap = shuffledSnapshot(link.options, link.correct_index, ctx.rng, attempt === 2 ? prev?.options : undefined);
  const row = newQuiz(ctx, s, { link_id: link.id, video_id: link.video_id, kind: "edu", mode, question: link.question, options: snap.options, correct_index: snap.correct_index, explanation: link.explanation, attempt });
  return ok({ ...publicQuiz(row) });
}

function canEarnCredit(ctx: Ctx, s: SessionRow, linkId: string): boolean {
  rollCreditDay(ctx, s);
  if (s.study_hall || phaseOf(ctx, s) === "quizOwed") return false;
  if (s.credits_earned_today >= ctx.config.creditsPerDay) return false;
  const v = ctx.store.data.link_views[`${s.id}:${linkId}`];
  if (v?.credit_earned_at != null && ctx.now - v.credit_earned_at < ctx.config.creditCooldownDays * DAY) return false;
  return true;
}

export function answerStudyQuiz(ctx: Ctx, s: SessionRow, input: { quizId?: unknown; answerIndex?: unknown }): Result {
  const q = typeof input.quizId === "string" ? ctx.store.data.quizzes[input.quizId] : undefined;
  if (!q || q.session_id !== s.id || q.kind !== "edu") return err(404, { error: "NotFound" });
  if (q.answered_at !== null) {
    if (q.result) return ok({ ...(q.result as Record<string, unknown>), alreadyAnswered: true });
    return err(409, { error: "Abandoned" });
  }
  const ai = Number.isInteger(input.answerIndex) ? (input.answerIndex as number) : null;
  const inTime = ctx.now <= q.expires_at;
  const correct = inTime && ai !== null && ai === q.correct_index;
  q.answered_at = ctx.now;
  q.answer_index = ai;
  q.correct = correct;
  if (s.pending_quiz_id === q.id) s.pending_quiz_id = null;
  const current = q.link_id === s.study_link_id;
  let result: Record<string, unknown> = { correct, expired: !inTime, explanation: q.explanation };
  if (correct) s.stats.eduPassed++;
  else s.stats.eduFailed++;

  if (q.mode === "studyHall" && s.study_hall && current) {
    if (correct) {
      s.study_completed = Math.min(s.study_completed + 1, s.study_required);
      if (s.study_completed >= s.study_required) {
        result = { ...result, ...exitStudyHall(ctx, s).body };
      } else {
        const n = pickEduLink(ctx, s, q.link_id);
        if (n) assignReel(ctx, s, n);
        result = { ...result, next: reelOf(n), study: studyState(ctx, s) };
      }
    } else if (q.attempt < 2) {
      s.study_attempt = 2;
      markServed(ctx, s, q.video_id, true);
      result = { ...result, watchAgain: true, study: studyState(ctx, s) };
    } else if (ctx.config.studyHallEscape && s.study_reels_this_visit >= ctx.config.maxReelsPerVisit) {
      result = { ...result, ...exitStudyHall(ctx, s, { escaped: true }).body };
    } else {
      const n = pickEduLink(ctx, s, q.link_id);
      if (n) assignReel(ctx, s, n);
      result = { ...result, next: reelOf(n), study: studyState(ctx, s) };
    }
  } else {
    // Voluntary study (or a stale Study Hall quiz): credits only when eligible.
    let creditEarned = false;
    if (correct && q.mode === "voluntary" && q.link_id && canEarnCredit(ctx, s, q.link_id)) {
      s.credits += 1;
      s.credits_earned_today += 1;
      s.credits_earned_total += 1;
      const v = ctx.store.data.link_views[`${s.id}:${q.link_id}`];
      if (v) v.credit_earned_at = ctx.now;
      else ctx.store.data.link_views[`${s.id}:${q.link_id}`] = { session_id: s.id, link_id: q.link_id, last_seen_at: ctx.now, times_seen: 1, credit_earned_at: ctx.now };
      creditEarned = true;
    }
    if (!correct && q.attempt < 2 && current) {
      s.study_attempt = 2;
      markServed(ctx, s, q.video_id, true);
      result = { ...result, watchAgain: true, creditEarned, study: studyState(ctx, s), credits: s.credits };
    } else {
      const n = pickEduLink(ctx, s, q.link_id);
      if (n) assignReel(ctx, s, n);
      result = { ...result, next: reelOf(n), creditEarned, study: studyState(ctx, s), credits: s.credits };
    }
  }
  result.credits = s.credits;
  q.result = result;
  ctx.store.touch();
  return ok(result);
}

// ---------- misc ----------

export function markUnplayable(ctx: Ctx, s: SessionRow, input: { videoId?: unknown; linkId?: unknown }): Result {
  const linkId = typeof input.linkId === "string" ? input.linkId : null;
  const videoId = typeof input.videoId === "string" ? input.videoId : null;
  if (!linkId && !videoId) return err(400, { error: "BadRequest" });
  const link = linkId ? ctx.store.data.links[linkId] : undefined;
  const eduLink = link?.kind === "edu" ? link : videoId ? Object.values(ctx.store.data.links).find((l) => l.kind === "edu" && l.video_id === videoId && l.id === s.study_link_id) : undefined;
  if (eduLink) {
    if (!s.unplayable.includes(eduLink.id)) s.unplayable.push(eduLink.id);
    const pq = pendingQuiz(ctx, s);
    if (pq?.link_id === eduLink.id) abandon(ctx, s, pq);
    if (s.study_link_id === eduLink.id) {
      const n = pickEduLink(ctx, s, eduLink.id);
      if (!n || n.id === eduLink.id) {
        if (s.study_hall) return exitStudyHall(ctx, s, { reason: "noPlayableLinks" });
        s.study_link_id = null;
        return ok({ next: null });
      }
      const visits = s.study_reels_this_visit;
      assignReel(ctx, s, n);
      s.study_reels_this_visit = visits; // unplayable reels don't count
      return ok({ next: reelOf(n), study: studyState(ctx, s) });
    }
    return ok({ next: null });
  }
  const vid = videoId ?? link?.video_id;
  if (vid && !s.unplayable.includes(vid)) s.unplayable.push(vid);
  const pq = pendingQuiz(ctx, s);
  if (pq?.kind === "fun" && pq.video_id === vid) abandon(ctx, s, pq);
  ctx.store.touch();
  return ok({ ok: true, advance: true });
}

export function getMe(ctx: Ctx, s: SessionRow): Result {
  const views = Object.values(ctx.store.data.link_views).filter((v) => v.session_id === s.id);
  const passedEdu = Object.values(ctx.store.data.quizzes).filter((q) => q.session_id === s.id && q.kind === "edu" && q.correct === true);
  const learned = new Set(passedEdu.map((q) => q.link_id));
  const topics = new Set(passedEdu.map((q) => ctx.store.data.links[q.link_id ?? ""]?.topic).filter(Boolean) as string[]);
  const st = s.stats;
  const total = st.funPassed + st.funFailed + st.eduPassed + st.eduFailed;
  return ok({
    reelsLearned: learned.size,
    reelsSeen: views.length,
    topics: [...topics],
    preferredTopics: s.topics,
    passRate: total ? (st.funPassed + st.eduPassed) / total : 0,
    creditsEarned: s.credits_earned_total,
    creditsSpent: s.credits_spent_total,
    credits: s.credits,
    creditsEnabled: s.credits_enabled,
    stats: st,
    availableTopics: [...new Set(Object.values(ctx.store.data.links).filter((l) => l.kind === "edu" && l.active).map((l) => l.topic))],
  });
}

export function updateSettings(ctx: Ctx, s: SessionRow, body: { creditsEnabled?: unknown; topics?: unknown }): Result {
  if (typeof body.creditsEnabled === "boolean") s.credits_enabled = body.creditsEnabled;
  if (Array.isArray(body.topics)) {
    const t = body.topics.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().toLowerCase()).slice(0, 20);
    s.topics = t.length ? t : [...ctx.config.defaultTopics];
  }
  ctx.store.touch();
  return ok({ creditsEnabled: s.credits_enabled, topics: s.topics });
}
