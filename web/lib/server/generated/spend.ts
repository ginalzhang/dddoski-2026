// In-memory daily spend accounting keyed by UTC day (resets on process restart).
export interface SpendDay {
  day: string;
  apifyUsd: number;
  llmUsd: number;
  quizzes: number;
  totalUsd: number;
}

const days = new Map<string, { apifyUsd: number; llmUsd: number; quizzes: number }>();
let nowFn: () => Date = () => new Date();

export function __setSpendClock(fn: (() => Date) | null) {
  nowFn = fn ?? (() => new Date());
}
export function __resetSpend() {
  days.clear();
}

function utcDay(): string {
  return nowFn().toISOString().slice(0, 10);
}

export function recordSpend(s: { apifyUsd?: number; llmUsd?: number; quizzes?: number }): void {
  const key = utcDay();
  const cur = days.get(key) ?? { apifyUsd: 0, llmUsd: 0, quizzes: 0 };
  cur.apifyUsd += s.apifyUsd ?? 0;
  cur.llmUsd += s.llmUsd ?? 0;
  cur.quizzes += s.quizzes ?? 0;
  days.set(key, cur);
}

export function spendToday(): SpendDay {
  const day = utcDay();
  const cur = days.get(day) ?? { apifyUsd: 0, llmUsd: 0, quizzes: 0 };
  return { day, ...cur, totalUsd: cur.apifyUsd + cur.llmUsd };
}

export function dailyCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  const v = raw ? Number(raw) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : 5;
}

export function overCap(): boolean {
  return spendToday().totalUsd >= dailyCapUsd();
}
