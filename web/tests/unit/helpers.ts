import { loadConfig, type Config } from "@/lib/server/config";
import { createSession, type Ctx } from "@/lib/server/game";
import { Store } from "@/lib/server/store";

export function vid(n: number, p = "e") {
  return (p + String(n).padStart(10, "0")).slice(0, 11);
}

export function makeCtx(opts: { edu?: number; fun?: number; topics?: string[]; config?: Partial<Config> } = {}) {
  const store = new Store();
  const edu = opts.edu ?? 4;
  for (let i = 0; i < edu; i++) {
    store.upsertLink({
      kind: "edu", video_id: vid(i, "e"), url: "", title: `Edu ${i}`, topic: opts.topics?.[i] ?? "math", difficulty: 1,
      question: `Q${i}?`, options: ["A", "B", "C", "D"], correct_index: 1, explanation: `Because B ${i}`,
    });
  }
  for (let i = 0; i < (opts.fun ?? 5); i++) {
    store.upsertLink({
      kind: "fun", video_id: vid(i, "f"), url: "", title: `Fun ${i}`, topic: "fun", difficulty: 1,
      question: `F${i}?`, options: ["W", "X", "Y"], correct_index: 2, explanation: `It was Y ${i}`,
    });
  }
  let seed = 42;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ctx: Ctx = { store, config: { ...loadConfig({}), ...opts.config }, now: 1_800_000_000_000, rng };
  const s = createSession(ctx);
  return { ctx, s, store };
}

export const tick = (ctx: Ctx, sec: number) => { ctx.now += sec * 1000; };

/** Correct option index in the public (shuffled) quiz. */
export function correctOf(ctx: Ctx, quizId: string) {
  return ctx.store.data.quizzes[quizId].correct_index;
}
