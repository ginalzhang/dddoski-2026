"use client";
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/immutability -- latest-ref pattern for window listeners and the YT callback bridge */
import { useEffect, useRef, useState } from "react";

export interface QuizView {
  quizId: string;
  question: string;
  options: string[];
  expiresAt: string;
  attempt?: number;
  kind: "fun" | "edu";
}

export function QuizPanel({
  quiz,
  onAnswer,
  busy,
}: {
  quiz: QuizView;
  onAnswer: (index: number) => void;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [left, setLeft] = useState(() => secondsLeft(quiz.expiresAt));
  const sentRef = useRef(false);
  const selRef = useRef<number | null>(null);
  selRef.current = selected;

  useEffect(() => {
    sentRef.current = false;
    setSelected(null);
  }, [quiz.quizId]);

  const submit = (i: number) => {
    if (sentRef.current || busy) return;
    sentRef.current = true;
    onAnswer(i);
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    const t = setInterval(() => {
      const l = secondsLeft(quiz.expiresAt);
      setLeft(l);
      if (l <= 0) submitRef.current(selRef.current ?? 0);
    }, 250);
    return () => clearInterval(t);
  }, [quiz.expiresAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= quiz.options.length) {
        e.preventDefault();
        setSelected(n - 1);
      } else if (e.key === "Enter" && selRef.current !== null) {
        e.preventDefault();
        submitRef.current(selRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [quiz.options.length]);

  return (
    <div
      data-testid="quiz-panel"
      className="flex h-full w-full flex-col gap-4 rounded-2xl bg-neutral-900 p-5 text-white"
    >
      <div className="flex items-center justify-between text-sm text-neutral-400">
        <span>
          {quiz.kind === "fun" ? "Quiz to continue" : "Study Hall quiz"}
          {quiz.attempt ? ` · attempt ${quiz.attempt}` : ""}
        </span>
        <span data-testid="countdown" className={left <= 5 ? "text-red-400" : ""}>
          {Math.max(0, Math.ceil(left))}s
        </span>
      </div>
      <h2 data-testid="quiz-question" className="text-lg font-semibold leading-snug">
        {quiz.question}
      </h2>
      <div className="flex flex-col gap-2">
        {quiz.options.map((o, i) => (
          <button
            key={i}
            data-testid={`option-${i}`}
            disabled={busy}
            onClick={() => submit(i)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              selected === i
                ? "border-yellow-400 bg-yellow-400/10"
                : "border-neutral-700 hover:border-neutral-400"
            }`}
          >
            <span className="mr-2 text-neutral-400">{i + 1}.</span>
            {o}
          </button>
        ))}
      </div>
      <p className="mt-auto text-xs text-neutral-500">Press 1–{quiz.options.length} then Enter, or click.</p>
    </div>
  );
}

function secondsLeft(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 30;
  return (t - Date.now()) / 1000;
}
