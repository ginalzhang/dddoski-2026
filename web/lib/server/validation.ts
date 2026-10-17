// Link validation, YouTube ID extraction and CSV parsing.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extract an 11-char YouTube ID from watch?v=, /shorts/, youtu.be/, /embed/, /live/ URLs or a raw ID. */
export function extractYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\./, "");
  let cand: string | null = null;
  if (host === "youtu.be") cand = url.pathname.split("/")[1] ?? null;
  else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const v = url.searchParams.get("v");
    if (v) cand = v;
    else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/);
      if (m) cand = m[1];
    }
  }
  return cand && ID_RE.test(cand) ? cand : null;
}

export interface LinkInput {
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
  active?: boolean;
  duration_s?: number | null;
  embeddable?: boolean | null;
  comment?: string;
}

export type ValidationResult = { ok: true; value: LinkInput } | { ok: false; error: string };

/** Validate quiz fields only (question/options/correct_index/explanation). Returns error string or null. */
export function validateQuiz(q: { question?: unknown; options?: unknown; correct_index?: unknown; explanation?: unknown }): string | null {
  if (typeof q.question !== "string" || !q.question.trim()) return "question is required";
  if (!Array.isArray(q.options)) return "options must be an array";
  const opts = q.options.map((o) => (typeof o === "string" ? o.trim() : ""));
  if (opts.length < 2 || opts.length > 4) return "need 2-4 options";
  if (opts.some((o) => !o)) return "options must be non-empty strings";
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return "options must be distinct";
  const ci = Number(q.correct_index);
  if (!Number.isInteger(ci) || ci < 0 || ci >= opts.length) return "correct_index out of range";
  if (typeof q.explanation !== "string" || !q.explanation.trim()) return "explanation is required";
  return null;
}

export function validateLinkInput(raw: Record<string, unknown>): ValidationResult {
  const kind = raw.kind;
  if (kind !== "fun" && kind !== "edu") return { ok: false, error: "kind must be fun or edu" };
  const vid = extractYouTubeId(String(raw.video_id ?? raw.url ?? raw.video_id_or_url ?? ""));
  if (!vid) return { ok: false, error: "could not extract an 11-char YouTube video id" };
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, error: "title is required" };
  const topic = (typeof raw.topic === "string" && raw.topic.trim() ? raw.topic.trim() : kind === "edu" ? "math" : "fun").toLowerCase();
  const d = raw.difficulty === undefined || raw.difficulty === "" ? 1 : Number(raw.difficulty);
  if (![1, 2, 3].includes(d)) return { ok: false, error: "difficulty must be 1, 2 or 3" };
  const options = Array.isArray(raw.options) ? raw.options.map((o) => String(o ?? "").trim()).filter((o) => o !== "") : [];
  const qErr = validateQuiz({ question: raw.question, options, correct_index: raw.correct_index, explanation: raw.explanation });
  if (qErr) return { ok: false, error: qErr };
  return {
    ok: true,
    value: {
      kind,
      video_id: vid,
      url: typeof raw.url === "string" && raw.url ? raw.url : `https://www.youtube.com/shorts/${vid}`,
      title,
      topic,
      difficulty: d as 1 | 2 | 3,
      question: String(raw.question).trim(),
      options,
      correct_index: Number(raw.correct_index),
      explanation: String(raw.explanation).trim(),
      active: raw.active === undefined ? true : !!raw.active,
      duration_s: typeof raw.duration_s === "number" ? raw.duration_s : null,
      embeddable: typeof raw.embeddable === "boolean" ? raw.embeddable : null,
      comment: typeof raw.comment === "string" ? raw.comment : undefined,
    },
  };
}

/** RFC4180-ish CSV parser: quoted fields, "" escapes, commas/newlines inside quotes. Returns rows with their 1-based start line. */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cur = "";
  let inQ = false;
  let line = 1;
  let rowStart = 1;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else {
        if (c === "\n") line++;
        cur += c;
      }
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === ",") { cells.push(cur); cur = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") {
      cells.push(cur);
      rows.push({ line: rowStart, cells });
      cells = []; cur = ""; line++; rowStart = line;
    } else cur += c;
  }
  if (cur !== "" || cells.length) { cells.push(cur); rows.push({ line: rowStart, cells }); }
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ""));
}

export const CSV_COLUMNS = ["kind", "video_id_or_url", "title", "topic", "difficulty", "question", "option1", "option2", "option3", "option4", "correct_index", "explanation"] as const;

/**
 * CSV import format (header row optional; detected when first cell is "kind"):
 *   kind,video_id_or_url,title,topic,difficulty,question,option1,option2,option3,option4,correct_index,explanation
 * option3/option4 may be empty. correct_index is 0-BASED and refers to the non-empty options in order.
 * Rejected rows are reported with 1-based line numbers of the source text.
 */
export function parseLinksCsv(text: string): { valid: { line: number; value: LinkInput }[]; rejected: { line: number; error: string }[] } {
  const rows = parseCsv(text);
  const valid: { line: number; value: LinkInput }[] = [];
  const rejected: { line: number; error: string }[] = [];
  for (const [i, r] of rows.entries()) {
    const c = r.cells.map((x) => x.trim());
    if (i === 0 && c[0]?.toLowerCase() === "kind") continue;
    if (c.length < 12) { rejected.push({ line: r.line, error: `expected 12 columns, got ${c.length}` }); continue; }
    const res = validateLinkInput({
      kind: c[0].toLowerCase(),
      video_id: c[1],
      url: /^https?:/i.test(c[1]) ? c[1] : undefined,
      title: c[2],
      topic: c[3],
      difficulty: c[4],
      question: c[5],
      options: [c[6], c[7], c[8], c[9]].filter((o) => o !== ""),
      correct_index: c[10] === "" ? NaN : Number(c[10]),
      explanation: c[11],
    });
    if (res.ok) valid.push({ line: r.line, value: res.value });
    else rejected.push({ line: r.line, error: res.error });
  }
  return { valid, rejected };
}
