"use client";
/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { api, refreshState } from "@/lib/client/api";
import { useAppState } from "@/lib/client/useAppState";

interface MeResponse {
  reelsLearned: number;
  topics: string[] | Record<string, number>;
  passRate: number;
  creditsEarned: number;
  creditsSpent: number;
  credits: number;
}

export default function MePage() {
  const state = useAppState();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [topicsText, setTopicsText] = useState("math");
  const [msg, setMsg] = useState<string | null>(null);

  const load = async () => {
    const r = await api<MeResponse>("/api/me");
    if (r.ok) setMe(r.data);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (body: { creditsEnabled?: boolean; topics?: string[] }) => {
    const r = await api("/api/settings", { body });
    setMsg(r.ok ? "Saved" : `Error: ${(r.data as any)?.error ?? r.status}`);
    refreshState();
    load();
  };

  const topicList = me
    ? Array.isArray(me.topics)
      ? me.topics.map((t) => [t, null] as const)
      : Object.entries(me.topics ?? {})
    : [];
  const pct = me ? (me.passRate <= 1 ? Math.round(me.passRate * 100) : Math.round(me.passRate)) : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">Your stats</h1>
      {me ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Reels learned" value={me.reelsLearned} testId="stat-reels" />
          <Stat label="Pass rate" value={`${pct}%`} testId="stat-pass-rate" />
          <Stat label="Brain Credits" value={me.credits} testId="stat-credits" />
          <Stat label="Credits earned" value={me.creditsEarned} testId="stat-earned" />
          <Stat label="Credits spent" value={me.creditsSpent} testId="stat-spent" />
        </div>
      ) : (
        <p className="text-neutral-400">Loading...</p>
      )}
      {topicList.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Topics</h2>
          <ul className="flex flex-wrap gap-2">
            {topicList.map(([t, n]) => (
              <li key={t} className="rounded-full bg-neutral-800 px-3 py-1 text-sm">
                {t}
                {n !== null ? ` · ${n}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <section className="flex flex-col gap-4 rounded-2xl bg-neutral-900 p-5">
        <h2 className="text-lg font-semibold">Settings</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            data-testid="credits-toggle"
            checked={state?.creditsEnabled ?? true}
            onChange={(e) => save({ creditsEnabled: e.target.checked })}
          />
          Use Brain Credits to auto-skip fun-feed quizzes
        </label>
        <div className="flex flex-col gap-2">
          <label htmlFor="topics" className="text-sm text-neutral-300">
            Preferred Study Hall topics (comma separated)
          </label>
          <div className="flex gap-2">
            <input
              id="topics"
              data-testid="topics-input"
              className="input flex-1"
              value={topicsText}
              onChange={(e) => setTopicsText(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={() =>
                save({
                  topics: topicsText
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            >
              Save topics
            </button>
          </div>
        </div>
        {msg && <p className="text-sm text-neutral-400">{msg}</p>}
      </section>
      <p className="text-xs text-neutral-500">
        Privacy: educational links never leave this server. In generated mode, fun-feed titles and transcripts are sent to
        Apify and the LLM provider.
      </p>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: number | string; testId: string }) {
  return (
    <div className="rounded-xl bg-neutral-900 p-4">
      <div className="text-xs uppercase text-neutral-400">{label}</div>
      <div data-testid={testId} className="text-2xl font-bold">
        {value}
      </div>
    </div>
  );
}
