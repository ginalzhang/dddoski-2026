"use client";
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/immutability -- latest-ref pattern for window listeners and the YT callback bridge */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EduReel, FunItem, StudyState } from "@/lib/types";
import { api, refreshState } from "@/lib/client/api";
import { minWatchSeconds, useYouTubePlayer } from "@/lib/client/useYouTubePlayer";
import { QuizPanel, type QuizView } from "./QuizPanel";

type Current =
  | { kind: "fun"; videoId: string; title: string }
  | { kind: "edu"; videoId: string; title: string; linkId: string; topic: string };

interface ResultView {
  correct: boolean;
  text: string;
  nextReel?: EduReel | null;
  resume?: boolean;
  resumeAfterVideoId?: string | null;
  watchAgain?: boolean;
  creditEarned?: boolean;
}

export function FeedApp({ mode }: { mode: "fun" | "study" }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const currentRef = useRef<Current | null>(null);
  const itemsRef = useRef<FunItem[]>([]);
  const idxRef = useRef(0);
  const cursorRef = useRef<string | null>(null);
  const passedRef = useRef<Set<string>>(new Set());
  const resumeAfterRef = useRef<string | null>(null);
  const dirRef = useRef<"next" | "prev">("next");
  const busyRef = useRef(false);
  const startedRef = useRef(false);

  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [hall, setHall] = useState(false);
  const [study, setStudy] = useState<StudyState | null>(null);
  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [result, setResult] = useState<ResultView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);
  const [busy, setBusyState] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const setBusy = (b: boolean) => {
    busyRef.current = b;
    setBusyState(b);
  };
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onErrorRef = useRef<(code: number, vid: string | null) => void>(() => {});
  const player = useYouTubePlayer({
    onError: (code, vid) => onErrorRef.current(code, vid),
    onAutoplayBlocked: () => setBlocked(true),
  });

  const setCur = (c: Current | null) => {
    currentRef.current = c;
    setCurrent(c);
  };

  const view: "player" | "quiz" | "result" = quiz ? "quiz" : result ? "result" : "player";

  // Never overlay the player: pause + mute + hide while a panel is shown.
  useEffect(() => {
    if (view !== "player") {
      player.pause();
      player.mute();
    } else {
      player.unMute();
      feedRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const playFun = useCallback(
    (i: number) => {
      const it = itemsRef.current[i];
      if (!it) return;
      idxRef.current = i;
      setCur({ kind: "fun", videoId: it.videoId, title: it.title });
      player.load(it.videoId, startedRef.current);
      feedRef.current?.focus();
    },
    [player],
  );

  const playEdu = useCallback(
    (reel: EduReel) => {
      setCur({ kind: "edu", ...reel });
      player.load(reel.videoId, startedRef.current);
      feedRef.current?.focus();
    },
    [player],
  );

  const fetchReel = useCallback(async (): Promise<EduReel | null> => {
    const r = await api<EduReel>("/api/study/next");
    if (r.ok && r.data?.videoId) return r.data;
    setBlockedMsg("No educational reels are available right now.");
    return null;
  }, []);

  const enterHall = useCallback(
    async (reel?: EduReel | null, st?: StudyState | null) => {
      setHall(true);
      if (st) setStudy(st);
      if (currentRef.current?.kind === "fun") resumeAfterRef.current = currentRef.current.videoId;
      const r = reel ?? (await fetchReel());
      if (r) playEdu(r);
      refreshState();
    },
    [fetchReel, playEdu],
  );

  const handleConflict = useCallback(
    async (data: any) => {
      const s = await refreshState();
      if (s?.pendingQuiz) {
        if (s.pendingQuiz.kind === "edu" || s.phase === "studyHall") {
          setHall(true);
          setStudy(s.study);
          if (s.study.reel && currentRef.current?.videoId !== s.study.reel.videoId) playEdu(s.study.reel);
        }
        setQuiz({ ...s.pendingQuiz, kind: s.pendingQuiz.kind ?? "fun" });
        return;
      }
      if (data?.error === "StudyHall" || s?.phase === "studyHall") {
        await enterHall(data?.study?.reel ?? s?.study.reel ?? null, data?.study ?? s?.study ?? null);
      }
    },
    [enterHall, playEdu],
  );

  /** Fetch the next feed page. Returns number of new items appended. */
  const loadMore = useCallback(
    async (reset = false): Promise<number> => {
      const cur = reset ? null : cursorRef.current;
      const r = await api<{ items: FunItem[]; cursor: string | null }>(
        `/api/feed${cur ? `?cursor=${encodeURIComponent(cur)}` : ""}`,
      );
      if (r.status === 409) {
        await handleConflict(r.data);
        return -1;
      }
      if (!r.ok || !r.data) return 0;
      if (reset) itemsRef.current = [];
      const seen = new Set(itemsRef.current.map((i) => i.videoId));
      const fresh = (r.data.items ?? []).filter((i) => !seen.has(i.videoId));
      itemsRef.current = [...itemsRef.current, ...fresh];
      cursorRef.current = r.data.cursor ?? null;
      return fresh.length;
    },
    [handleConflict],
  );

  const move = useCallback(
    async (dir: "next" | "prev") => {
      if (dir === "prev") {
        if (idxRef.current > 0) playFun(idxRef.current - 1);
        return;
      }
      let ni = idxRef.current + 1;
      if (ni >= itemsRef.current.length) {
        const n = await loadMore();
        if (n < 0) return;
        if (ni >= itemsRef.current.length) {
          showToast("You reached the end of the feed");
          return;
        }
      }
      // skip removed items gracefully
      ni = Math.min(ni, itemsRef.current.length - 1);
      playFun(ni);
    },
    [loadMore, playFun, showToast],
  );

  // ---- initial load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await refreshState();
      if (cancelled) return;
      if (s?.resumeAfterVideoId) resumeAfterRef.current = s.resumeAfterVideoId;
      if (mode === "study") {
        if (s && (s.phase === "studyHall" || s.phase === "quizOwed")) {
          setBlockedMsg(
            s.phase === "studyHall"
              ? "You are in Study Hall. Finish it on the feed first (credits cannot be earned now)."
              : "A quiz is owed on the feed. Answer it first (credits cannot be earned now).",
          );
          return;
        }
        const reel = await fetchReel();
        if (reel && !cancelled) playEdu(reel);
        return;
      }
      if (s?.pendingQuiz) {
        await handleConflict(null);
        if (s.pendingQuiz.kind !== "edu" && s.phase !== "studyHall") {
          // load the feed in the background so we can advance after answering
          await loadMore(true);
        }
        return;
      }
      if (s?.phase === "studyHall") {
        setHall(true);
        setStudy(s.study);
        const reel = s.study.reel ?? (await fetchReel());
        if (reel && !cancelled) playEdu(reel);
        return;
      }
      const n = await loadMore(true);
      if (cancelled || n < 0) return;
      if (itemsRef.current.length) playFun(0);
      else setBlockedMsg("The feed is empty.");
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- unplayable ----
  onErrorRef.current = async (_code, vid) => {
    const c = currentRef.current;
    if (!c || c.videoId !== vid) return;
    if (c.kind === "edu") {
      await api("/api/video/unplayable", { body: { linkId: c.linkId } });
      showToast("That reel can't be played here; skipping");
      const reel = await fetchReel();
      if (reel) playEdu(reel);
    } else {
      await api("/api/video/unplayable", { body: { videoId: c.videoId } });
      showToast("That Short can't be played here; skipping");
      const i = idxRef.current;
      itemsRef.current = itemsRef.current.filter((x) => x.videoId !== c.videoId);
      if (i >= itemsRef.current.length) {
        const n = await loadMore();
        if (n <= 0 && !itemsRef.current.length) return;
      }
      playFun(Math.min(i, itemsRef.current.length - 1));
    }
  };

  // ---- gate ----
  const takeQuiz = useCallback(async () => {
    const c = currentRef.current;
    if (!c || c.kind !== "edu" || busyRef.current) return;
    const w = player.getWatched();
    const d = player.getDuration();
    if (w < minWatchSeconds(d)) {
      showToast("Finish the reel first");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/api/study/quiz/start", {
        body: { linkId: c.linkId, watchedSeconds: w, durationSeconds: d },
      });
      if (r.ok && r.data?.quizId) setQuiz({ ...r.data, kind: "edu" });
      else if (r.status === 400) showToast("Finish the reel first");
      else if (r.status === 409) await handleConflict(r.data);
      else showToast(r.data?.error ?? "Could not start the quiz");
    } finally {
      setBusy(false);
    }
  }, [player, showToast, handleConflict]);

  const attemptAdvance = useCallback(
    async (dir: "next" | "prev") => {
      if (busyRef.current || quiz || result) return;
      const c = currentRef.current;
      if (!c) return;
      if (c.kind === "edu") {
        if (dir === "next") await takeQuiz();
        return;
      }
      if (dir === "prev" && idxRef.current === 0) return;
      if (passedRef.current.has(c.videoId)) {
        await move(dir);
        return;
      }
      const w = player.getWatched();
      const d = player.getDuration();
      if (w < minWatchSeconds(d)) {
        showToast("Finish the Short first");
        return;
      }
      setBusy(true);
      try {
        const r = await api("/api/quiz/start", {
          body: { videoId: c.videoId, direction: dir, watchedSeconds: w, durationSeconds: d },
        });
        if (r.status === 400) {
          showToast("Finish the Short first");
        } else if (r.status === 409) {
          await handleConflict(r.data);
        } else if (r.ok && r.data?.skipped) {
          passedRef.current.add(c.videoId);
          showToast("Brain Credit used: quiz skipped");
          refreshState();
          await move(dir);
        } else if (r.ok && r.data?.quizId) {
          dirRef.current = dir;
          setQuiz({ ...r.data, kind: "fun" });
          refreshState();
        } else {
          showToast(r.data?.error ?? "Something went wrong");
        }
      } finally {
        setBusy(false);
      }
    },
    [quiz, result, player, move, showToast, handleConflict, takeQuiz],
  );

  const answer = useCallback(
    async (index: number) => {
      const q = quiz;
      if (!q || busyRef.current) return;
      setBusy(true);
      try {
        if (q.kind === "fun") {
          const r = await api("/api/quiz/answer", { body: { quizId: q.quizId, answerIndex: index } });
          setQuiz(null);
          if (r.status === 409) {
            await handleConflict(r.data);
            return;
          }
          const c = currentRef.current;
          if (r.data?.correct) {
            if (c) passedRef.current.add(c.videoId);
            showToast("Correct!");
            setBanner(null);
            refreshState();
            if (!c || !itemsRef.current.length) {
              await loadMore(true);
              const pos = c ? itemsRef.current.findIndex((x) => x.videoId === c.videoId) : -1;
              if (pos >= 0) idxRef.current = pos;
              else if (itemsRef.current.length) {
                playFun(0);
                return;
              }
            }
            await move(dirRef.current);
          } else {
            setBanner(`Wrong. ${r.data?.rationale ?? ""} Welcome to Study Hall.`);
            await enterHall(r.data?.study?.reel ?? null, r.data?.study ?? null);
          }
        } else {
          const r = await api("/api/study/quiz/answer", { body: { quizId: q.quizId, answerIndex: index } });
          setQuiz(null);
          const d = r.data ?? {};
          if (d.study) setStudy(d.study);
          if (d.resumeAfterVideoId) resumeAfterRef.current = d.resumeAfterVideoId;
          setResult({
            correct: !!d.correct,
            text: d.explanation ?? d.error ?? "",
            nextReel: d.next && d.next !== "resume" ? d.next : null,
            resume: d.next === "resume",
            resumeAfterVideoId: d.resumeAfterVideoId ?? null,
            watchAgain: !!d.watchAgain,
            creditEarned: !!d.creditEarned,
          });
          refreshState();
        }
      } finally {
        setBusy(false);
      }
    },
    [quiz, handleConflict, showToast, loadMore, playFun, move, enterHall],
  );

  const watchAgain = () => {
    const c = currentRef.current;
    setResult(null);
    if (c) player.load(c.videoId, true);
  };
  const nextReel = async () => {
    const r = result;
    setResult(null);
    const reel = r?.nextReel ?? (await fetchReel());
    if (reel) playEdu(reel);
  };
  const backToFeed = async () => {
    const after = result?.resumeAfterVideoId ?? resumeAfterRef.current;
    setResult(null);
    setHall(false);
    setStudy(null);
    setBanner(null);
    let pos = after ? itemsRef.current.findIndex((x) => x.videoId === after) : -1;
    if (pos < 0 || pos + 1 >= itemsRef.current.length) {
      const n = await loadMore(pos < 0);
      if (n < 0) return;
      pos = after ? itemsRef.current.findIndex((x) => x.videoId === after) : -1;
    }
    const target = pos + 1;
    if (target < itemsRef.current.length) playFun(target);
    else if (itemsRef.current.length) playFun(itemsRef.current.length - 1);
    refreshState();
  };

  // ---- input: keys, wheel, touch on window ----
  const advRef = useRef(attemptAdvance);
  advRef.current = attemptAdvance;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (viewRef.current !== "player") return;
      if (["ArrowDown", "j", "PageDown"].includes(e.key)) {
        e.preventDefault();
        advRef.current("next");
      } else if (["ArrowUp", "k", "PageUp"].includes(e.key)) {
        e.preventDefault();
        advRef.current("prev");
      }
    };
    let lastWheel = 0;
    const onWheel = (e: WheelEvent) => {
      if (viewRef.current !== "player" || Math.abs(e.deltaY) < 30) return;
      const now = Date.now();
      if (now - lastWheel < 800) return;
      lastWheel = now;
      advRef.current(e.deltaY > 0 ? "next" : "prev");
    };
    let touchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (touchY === null || viewRef.current !== "player") return;
      const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY);
      touchY = null;
      if (Math.abs(dy) > 50) advRef.current(dy > 0 ? "next" : "prev");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  const startPlay = () => {
    startedRef.current = true;
    setStarted(true);
    setBlocked(false);
    player.play();
    feedRef.current?.focus();
  };

  const isEdu = current?.kind === "edu";
  const need = minWatchSeconds(player.duration);
  const watchedEnough = player.watched >= need && player.duration > 0;

  return (
    <div
      ref={feedRef}
      tabIndex={-1}
      data-testid="feed"
      data-mode={mode}
      data-hall={hall ? "1" : "0"}
      className="flex flex-1 flex-col items-center justify-center gap-4 p-4 outline-none md:flex-row md:items-start"
    >
      <div className="flex flex-col items-center gap-2">
        {/* Player container: hidden (never covered) while any panel shows. The YT.Player stays alive. */}
        <div
          data-testid="player"
          data-video-id={current?.videoId ?? ""}
          data-kind={current?.kind ?? ""}
          style={{ display: view === "player" ? "block" : "none" }}
          className="relative aspect-[9/16] w-[min(100vw-2rem,360px)] min-w-[200px] overflow-hidden rounded-2xl bg-black md:w-[360px]"
        >
          <div ref={player.mountRef} className="h-full w-full" />
        </div>
        {view === "quiz" && quiz && (
          <div className="aspect-[9/16] w-[min(100vw-2rem,360px)] md:w-[360px]">
            <QuizPanel quiz={quiz} onAnswer={answer} busy={busy} />
          </div>
        )}
        {view === "result" && result && (
          <div
            data-testid="study-panel"
            className="flex aspect-[9/16] w-[min(100vw-2rem,360px)] flex-col gap-4 rounded-2xl bg-neutral-900 p-5 text-white md:w-[360px]"
          >
            <h2 data-testid="result" className={`text-xl font-bold ${result.correct ? "text-green-400" : "text-red-400"}`}>
              {result.correct ? "Correct!" : "Not quite."}
            </h2>
            <p data-testid="explanation" className="text-sm leading-relaxed text-neutral-200">
              {result.text}
            </p>
            {result.creditEarned && (
              <p data-testid="credit-earned" className="rounded-lg bg-amber-500 px-3 py-2 font-bold text-black">
                +1 Brain Credit
              </p>
            )}
            {study && hall && (
              <p data-testid="study-progress" className="text-sm text-neutral-400">
                Study Hall progress: {study.completed}/{study.required}
              </p>
            )}
            <div className="mt-auto flex flex-col gap-2">
              {result.watchAgain && (
                <button data-testid="watch-again" onClick={watchAgain} className="btn-primary">
                  Watch again
                </button>
              )}
              {result.resume && (
                <button data-testid="back-to-feed" onClick={backToFeed} className="btn-primary">
                  Back to the feed
                </button>
              )}
              {!result.watchAgain && !result.resume && (
                <button data-testid="next-reel" onClick={nextReel} className="btn-primary">
                  Next reel
                </button>
              )}
            </div>
          </div>
        )}
        {view === "player" && (!started || blocked) && current && (
          <button data-testid="play" onClick={startPlay} className="btn-primary w-full text-lg">
            Play
          </button>
        )}
      </div>

      <aside className="flex w-full max-w-[360px] flex-col gap-3 text-white">
        {blockedMsg && (
          <div data-testid="blocked" className="rounded-xl bg-neutral-800 p-3 text-sm">
            {blockedMsg} {mode === "study" && <Link className="underline" href="/">Go to the feed</Link>}
          </div>
        )}
        {toast && (
          <div data-testid="toast" role="status" className="rounded-xl bg-yellow-400 px-3 py-2 font-semibold text-black">
            {toast}
          </div>
        )}
        {banner && (
          <div data-testid="banner" className="rounded-xl bg-red-900/60 p-3 text-sm">
            {banner}
          </div>
        )}
        {(hall || mode === "study") && (
          <div data-testid="study-status" className="rounded-xl bg-neutral-800 p-3 text-sm">
            {hall ? (
              <>
                <b>Study Hall</b>: answer educational reels correctly to return.{" "}
                {study && (
                  <span>
                    Progress {study.completed}/{study.required}
                  </span>
                )}
              </>
            ) : (
              <>
                <b>Study</b>: watch a reel and pass its quiz to earn a Brain Credit.
              </>
            )}
          </div>
        )}
        {current && view === "player" && (
          <div className="text-sm text-neutral-300">
            <div data-testid="title" className="font-semibold">
              {current.title}
            </div>
            {current.kind === "edu" && <div className="text-neutral-500">Topic: {current.topic}</div>}
            <div data-testid="watched" className="text-neutral-500">
              Watched {player.watched.toFixed(1)}s
            </div>
          </div>
        )}
        {view === "player" && current && isEdu && (
          <button
            data-testid="take-quiz"
            onClick={takeQuiz}
            disabled={!watchedEnough || busy}
            className="btn-primary disabled:opacity-40"
          >
            {watchedEnough ? "Take the quiz" : "Keep watching..."}
          </button>
        )}
        {mode === "fun" && (
          <div className="flex gap-2">
            <button
              data-testid="prev"
              onClick={() => attemptAdvance("prev")}
              disabled={view !== "player"}
              className="btn-secondary flex-1"
            >
              Prev
            </button>
            <button
              data-testid="next"
              onClick={() => attemptAdvance("next")}
              disabled={view !== "player"}
              className="btn-primary flex-1"
            >
              Next
            </button>
          </div>
        )}
        <p className="text-xs text-neutral-500">
          Keys: ArrowDown/j/PageDown next, ArrowUp/k/PageUp previous. Videos play via the official YouTube player.
        </p>
      </aside>
    </div>
  );
}
