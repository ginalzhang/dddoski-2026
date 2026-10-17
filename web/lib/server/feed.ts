// Fun feed: curated (links kind='fun') or generated (lib/server/generated, written by another module).
import { feedCurated, serveFeed, startFunQuiz, type Ctx, type FunQuizContent, type FunStartInput, type Result } from "./game";
import type { SessionRow } from "./store";
import type { FunItem } from "@/lib/types";

type GenModule = {
  discoverFunFeed?: (cursor: string | null) => Promise<{ items: FunItem[]; cursor: string | null }>;
  generateFunQuiz?: (videoId: string) => Promise<FunQuizContent>;
};

async function loadGenerated(): Promise<GenModule | null> {
  try {
    return (await import("@/lib/server/generated")) as GenModule;
  } catch (e) {
    console.warn("[feed] generated module unavailable, using curated:", (e as Error).message);
    return null;
  }
}

export async function getFeed(ctx: Ctx, s: SessionRow, cursor: string | null, after: string | null): Promise<Result> {
  // Always run the curated path first for the 409 checks.
  const curated = feedCurated(ctx, s, cursor, after);
  if (curated.status !== 200 || ctx.config.funFeedMode !== "generated") return curated;
  const gen = await loadGenerated();
  if (!gen?.discoverFunFeed) return curated;
  try {
    const page = await gen.discoverFunFeed(cursor);
    if (!page?.items?.length) return curated;
    return { status: 200, body: serveFeed(ctx, s, page) };
  } catch (e) {
    console.warn("[feed] discoverFunFeed failed, curated fallback:", (e as Error).message);
    return curated;
  }
}

export async function startFun(ctx: Ctx, s: SessionRow, input: FunStartInput): Promise<Result> {
  const r = startFunQuiz(ctx, s, input);
  if (r.status !== 0) return r;
  let content: FunQuizContent | null = null;
  const gen = await loadGenerated();
  if (gen?.generateFunQuiz && typeof input.videoId === "string") {
    try {
      content = await gen.generateFunQuiz(input.videoId);
    } catch (e) {
      console.warn("[feed] generateFunQuiz failed:", (e as Error).message);
    }
  }
  ctx.now = Date.now();
  return startFunQuiz(ctx, s, input, content);
}
