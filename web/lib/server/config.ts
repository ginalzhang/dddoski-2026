// Server config from env with defaults. Read lazily so tests can override.
export interface Config {
  minWatchFraction: number;
  answerTimeoutSec: number;
  maxRequired: number;
  creditsPerDay: number;
  creditCooldownDays: number;
  passDays: number;
  studyHallEscape: boolean;
  maxReelsPerVisit: number;
  funFeedMode: "curated" | "generated";
  wallclockSlackSec: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  defaultTopics: string[];
}

function num(v: string | undefined, d: number): number {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const hasKeys = !!env.APIFY_TOKEN && !!env.ANTHROPIC_API_KEY;
  const requested = env.FUN_FEED_MODE === "curated" ? "curated" : env.FUN_FEED_MODE === "generated" ? "generated" : undefined;
  // generated is the spec default, but only possible with both keys; otherwise curated.
  const funFeedMode: Config["funFeedMode"] = requested === "curated" ? "curated" : hasKeys ? "generated" : "curated";
  return {
    minWatchFraction: num(env.MIN_WATCH_FRACTION, 0.7),
    answerTimeoutSec: num(env.ANSWER_TIMEOUT_SEC, 30),
    maxRequired: num(env.MAX_REQUIRED, 3),
    creditsPerDay: num(env.CREDITS_PER_DAY, 5),
    creditCooldownDays: 7,
    passDays: 7,
    studyHallEscape: env.STUDY_HALL_ESCAPE === "1" || env.STUDY_HALL_ESCAPE === "true",
    maxReelsPerVisit: num(env.MAX_REELS_PER_VISIT, 6),
    funFeedMode,
    wallclockSlackSec: 2,
    rateLimitMax: num(env.RATE_LIMIT_MAX, 30),
    rateLimitWindowMs: num(env.RATE_LIMIT_WINDOW_MS, 10_000),
    defaultTopics: ["math"],
  };
}
