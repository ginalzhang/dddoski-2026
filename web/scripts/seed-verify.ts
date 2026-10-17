/**
 * seed:verify — checks every YouTube link in the seed files (and optional
 * user-supplied data files) is still playable as an embed, and that each
 * quiz has a valid shape.
 *
 *   npx tsx scripts/seed-verify.ts            # report only
 *   npx tsx scripts/seed-verify.ts --write    # flip active=false + comment on failures
 *
 * Files checked:
 *   seed/edu-links.json, seed/fun-links.json                (SeedLink[])
 *   data/edu-links.json, data/fun-links.json if present     (lenient: URL strings or objects)
 *   (paths overridable via EDU_LINKS_PATH / FUN_LINKS_PATH)
 *
 * With YOUTUBE_API_KEY set: Data API videos.list (status.embeddable,
 * contentDetails.duration <= 180s, no age restriction). Otherwise oEmbed:
 * 200 = ok, 401/403 = embedding disabled, 404/400 = gone.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const WRITE = process.argv.includes("--write");
const API_KEY = process.env.YOUTUBE_API_KEY?.trim();
const MAX_DURATION_S = 180;

type Row = Record<string, unknown> | string;

interface Check {
  ok: boolean;
  reason?: string;
  embeddable?: boolean | null;
  duration_s?: number | null;
  title?: string;
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function extractVideoId(input: string): string | null {
  const s = input.trim();
  if (ID_RE.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.endsWith("youtu.be")) {
      const id = u.pathname.split("/")[1] ?? "";
      return ID_RE.test(id) ? id : null;
    }
    const v = u.searchParams.get("v");
    if (v && ID_RE.test(v)) return v;
    const m = u.pathname.match(/\/(shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

function rowId(row: Row): string | null {
  if (typeof row === "string") return extractVideoId(row);
  const raw = (row.video_id ?? row.videoId ?? row.url ?? row.link) as string | undefined;
  return typeof raw === "string" ? extractVideoId(raw) : null;
}

/** Returns a list of problems with the row's quiz (empty = ok / no quiz). */
export function quizProblems(row: Row, requireQuiz: boolean): string[] {
  if (typeof row === "string") return requireQuiz ? ["no quiz (plain URL)"] : [];
  const hasQuiz = row.question != null || row.options != null;
  if (!hasQuiz) return requireQuiz ? ["missing quiz"] : [];
  const p: string[] = [];
  if (typeof row.question !== "string" || !row.question.trim()) p.push("question empty");
  const opts = row.options;
  if (!Array.isArray(opts)) {
    p.push("options not an array");
  } else {
    if (opts.length < 2 || opts.length > 4) p.push(`options count ${opts.length} (need 2-4)`);
    if (opts.some((o) => typeof o !== "string" || !o.trim())) p.push("empty option");
    const norm = opts.map((o) => String(o).trim().toLowerCase());
    if (new Set(norm).size !== norm.length) p.push("duplicate options");
    const ci = row.correct_index;
    if (typeof ci !== "number" || !Number.isInteger(ci) || ci < 0 || ci >= opts.length)
      p.push(`correct_index ${String(ci)} out of range`);
  }
  if (typeof row.explanation !== "string" || !row.explanation.trim()) p.push("explanation empty");
  return p;
}

function parseIsoDuration(iso: string): number {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return NaN;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

async function checkViaApi(ids: string[]): Promise<Map<string, Check>> {
  const out = new Map<string, Check>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url =
      "https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails,snippet&id=" +
      batch.join(",") +
      "&key=" +
      encodeURIComponent(API_KEY!);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Data API ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { items?: any[] };
    const found = new Map((json.items ?? []).map((it) => [it.id as string, it]));
    for (const id of batch) {
      const it = found.get(id);
      if (!it) {
        out.set(id, { ok: false, reason: "video not found / private", embeddable: null });
        continue;
      }
      const embeddable = Boolean(it.status?.embeddable);
      const duration = parseIsoDuration(it.contentDetails?.duration ?? "");
      const age = it.contentDetails?.contentRating?.ytRating === "ytAgeRestricted";
      const reasons: string[] = [];
      if (!embeddable) reasons.push("embedding disabled");
      if (it.status?.privacyStatus && it.status.privacyStatus === "private") reasons.push("private");
      if (Number.isFinite(duration) && duration > MAX_DURATION_S) reasons.push(`duration ${duration}s > ${MAX_DURATION_S}s`);
      if (age) reasons.push("age restricted");
      out.set(id, {
        ok: reasons.length === 0,
        reason: reasons.join("; ") || undefined,
        embeddable,
        duration_s: Number.isFinite(duration) ? duration : null,
        title: it.snippet?.title,
      });
    }
  }
  return out;
}

async function checkViaOembed(id: string): Promise<Check> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/shorts/${id}`,
  )}&format=json`;
  try {
    const res = await fetch(url);
    if (res.status === 200) {
      const j = (await res.json()) as { title?: string };
      return { ok: true, embeddable: true, title: j.title };
    }
    if (res.status === 401 || res.status === 403)
      return { ok: false, reason: `embedding disabled (oEmbed ${res.status})`, embeddable: false };
    if (res.status === 404 || res.status === 400)
      return { ok: false, reason: `video gone (oEmbed ${res.status})`, embeddable: null };
    return { ok: false, reason: `oEmbed HTTP ${res.status} (transient?)`, embeddable: null };
  } catch (e) {
    return { ok: false, reason: `network error: ${(e as Error).message}`, embeddable: null };
  }
}

interface FileSpec {
  label: string;
  file: string;
  strict: boolean; // seed files must be full SeedLink rows with quizzes
}

function files(): FileSpec[] {
  const list: FileSpec[] = [
    { label: "seed/edu", file: path.join(ROOT, "seed/edu-links.json"), strict: true },
    { label: "seed/fun", file: path.join(ROOT, "seed/fun-links.json"), strict: true },
  ];
  const eduData = process.env.EDU_LINKS_PATH
    ? path.resolve(ROOT, process.env.EDU_LINKS_PATH)
    : path.join(ROOT, "data/edu-links.json");
  const funData = process.env.FUN_LINKS_PATH
    ? path.resolve(ROOT, process.env.FUN_LINKS_PATH)
    : path.join(ROOT, "data/fun-links.json");
  if (existsSync(eduData)) list.push({ label: "data/edu", file: eduData, strict: false });
  if (existsSync(funData)) list.push({ label: "data/fun", file: funData, strict: false });
  return list;
}

function pad(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

async function main() {
  const specs = files();
  const loaded: { spec: FileSpec; rows: Row[] }[] = [];
  for (const spec of specs) {
    const parsed = JSON.parse(readFileSync(spec.file, "utf8"));
    const rows: Row[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.links) ? parsed.links : [];
    loaded.push({ spec, rows });
  }

  const allIds = [...new Set(loaded.flatMap(({ rows }) => rows.map(rowId).filter((x): x is string => !!x)))];
  console.log(
    `Checking ${allIds.length} unique video IDs via ${API_KEY ? "YouTube Data API" : "oEmbed (no YOUTUBE_API_KEY)"}…\n`,
  );

  let results: Map<string, Check>;
  if (API_KEY) {
    results = await checkViaApi(allIds);
  } else {
    results = new Map();
    const queue = [...allIds];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const id = queue.shift()!;
          results.set(id, await checkViaOembed(id));
        }
      }),
    );
  }

  let failures = 0;
  let active = 0;
  console.log(`${pad("FILE", 9)} ${pad("VIDEO_ID", 12)} ${pad("STATUS", 7)} ${pad("TITLE", 44)} NOTES`);
  console.log("-".repeat(110));
  for (const { spec, rows } of loaded) {
    let changed = false;
    rows.forEach((row, i) => {
      const id = rowId(row);
      const notes: string[] = [];
      let ok = true;
      if (!id) {
        ok = false;
        notes.push("cannot extract 11-char video ID");
      }
      const chk = id ? results.get(id) : undefined;
      if (chk && !chk.ok) {
        ok = false;
        notes.push(chk.reason ?? "failed");
      }
      const qp = quizProblems(row, spec.strict);
      if (qp.length) {
        ok = false;
        notes.push("quiz: " + qp.join(", "));
      }
      const wasActive = typeof row === "string" ? true : row.active !== false;
      const title = (typeof row === "string" ? chk?.title : (row.title as string)) ?? chk?.title ?? "";
      if (ok && wasActive) active++;
      if (!ok) failures++;
      const status = ok ? (wasActive ? "OK" : "OK*") : "FAIL";
      console.log(
        `${pad(spec.label, 9)} ${pad(id ?? `row ${i + 1}`, 12)} ${pad(status, 7)} ${pad(title, 44)} ${notes.join(" | ")}${
          !wasActive ? (typeof row !== "string" && row.comment ? ` (inactive: ${row.comment})` : " (inactive)") : ""
        }`,
      );

      if (WRITE && typeof row !== "string") {
        if (chk) {
          if (chk.embeddable !== undefined && row.embeddable !== chk.embeddable) {
            row.embeddable = chk.embeddable;
            changed = true;
          }
          if (chk.duration_s != null && row.duration_s !== chk.duration_s) {
            row.duration_s = chk.duration_s;
            changed = true;
          }
        }
        if (!ok && row.active !== false) {
          row.active = false;
          row.comment = `seed:verify ${new Date().toISOString().slice(0, 10)}: ${notes.join("; ")}`;
          changed = true;
        }
      }
    });
    if (WRITE && changed) {
      writeFileSync(spec.file, JSON.stringify(rows, null, 2) + "\n");
      console.log(`  -> wrote ${path.relative(ROOT, spec.file)}`);
    }
  }

  console.log("-".repeat(110));
  console.log(`${active} active+verified, ${failures} failing.${failures && !WRITE ? " Re-run with --write to deactivate failures." : ""}`);
  if (loaded.some(({ rows }) => rows.some((r) => typeof r === "string")) && WRITE)
    console.log("Note: plain-URL rows cannot be annotated in place; fix those files by hand.");
  process.exitCode = failures && !WRITE ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
