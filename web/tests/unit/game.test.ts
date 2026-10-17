import { describe, expect, it } from "vitest";
import {
  answerFunQuiz, answerStudyQuiz, feedCurated, getMe, getState, markServed, markUnplayable, pickEduLink, requiredWatchSeconds,
  startFunQuiz, startStudyQuiz, studyNext,
} from "@/lib/server/game";
import { adminUpdateLink } from "@/lib/server/admin";
import type { Ctx } from "@/lib/server/game";
import type { SessionRow } from "@/lib/server/store";
import { correctOf, makeCtx, tick, vid } from "./helpers";

type B = Record<string, any>;

function startFun(ctx: Ctx, s: SessionRow, videoId: string, watch = 12, dur = 15) {
  feedCurated(ctx, s, "0");
  markServed(ctx, s, videoId);
  tick(ctx, watch);
  return startFunQuiz(ctx, s, { videoId, direction: "next", watchedSeconds: watch, durationSeconds: dur });
}
function failFun(ctx: Ctx, s: SessionRow, videoId = vid(0, "f")) {
  const q = startFun(ctx, s, videoId).body as B;
  if (!q.quizId) throw new Error(JSON.stringify(q));
  const wrong = (correctOf(ctx, q.quizId) + 1) % 3;
  return answerFunQuiz(ctx, s, { quizId: q.quizId, answerIndex: wrong }).body as B;
}
function passFun(ctx: Ctx, s: SessionRow, videoId: string) {
  const q = startFun(ctx, s, videoId).body as B;
  return answerFunQuiz(ctx, s, { quizId: q.quizId, answerIndex: correctOf(ctx, q.quizId) }).body as B;
}
function studyQuiz(ctx: Ctx, s: SessionRow, linkId: string, watch = 12) {
  tick(ctx, watch);
  return startStudyQuiz(ctx, s, { linkId, watchedSeconds: watch, durationSeconds: 15 });
}
function answerStudy(ctx: Ctx, s: SessionRow, linkId: string, right: boolean) {
  const q = studyQuiz(ctx, s, linkId).body as B;
  const c = correctOf(ctx, q.quizId);
  return answerStudyQuiz(ctx, s, { quizId: q.quizId, answerIndex: right ? c : (c + 1) % 4 }).body as B;
}

describe("fun grading", () => {
  it("feed returns up to 3 items and a cursor", () => {
    const { ctx, s } = makeCtx();
    const r = feedCurated(ctx, s, null).body as B;
    expect(r.items).toHaveLength(3);
    expect(r.cursor).toBe("3");
    expect((feedCurated(ctx, s, "3").body as B).cursor).toBeNull();
    expect((feedCurated(ctx, s, null, vid(1, "f")).body as B).items[0].videoId).toBe(vid(2, "f"));
  });

  it("never exposes the correct index and grades correct -> pass", () => {
    const { ctx, s } = makeCtx();
    const q = startFun(ctx, s, vid(0, "f")).body as B;
    expect(q).not.toHaveProperty("correct_index");
    expect(q).not.toHaveProperty("correctIndex");
    expect(q.options).toHaveLength(3);
    expect(getState(ctx, s).phase).toBe("quizOwed");
    const a = answerFunQuiz(ctx, s, { quizId: q.quizId, answerIndex: correctOf(ctx, q.quizId) }).body as B;
    expect(a.correct).toBe(true);
    expect(getState(ctx, s).phase).toBe("free");
    // passed video skips quiz for 7 days
    expect((startFunQuiz(ctx, s, { videoId: vid(0, "f"), watchedSeconds: 0, durationSeconds: 15 }).body as B).reason).toBe("passed");
  });

  it("enforces min watch and wall-clock forgery check", () => {
    const { ctx, s } = makeCtx();
    feedCurated(ctx, s, "0");
    tick(ctx, 5);
    expect(startFunQuiz(ctx, s, { videoId: vid(0, "f"), watchedSeconds: 5, durationSeconds: 20 }).body.error).toBe("MinWatch");
    expect(startFunQuiz(ctx, s, { videoId: vid(0, "f"), watchedSeconds: 14, durationSeconds: 20 }).body.error).toBe("WatchForged");
    expect(startFunQuiz(ctx, s, { videoId: "zzzzzzzzzzz", watchedSeconds: 1, durationSeconds: 20 }).body.error).toBe("NotServed");
    expect(requiredWatchSeconds(100, 0.7)).toBe(70);
    expect(requiredWatchSeconds(8, 0.7)).toBe(8);
    expect(requiredWatchSeconds(12, 0.7)).toBe(10);
  });

  it("answer after expiry is wrong; expired pending quiz is settled by state", () => {
    const { ctx, s } = makeCtx();
    const q = startFun(ctx, s, vid(0, "f")).body as B;
    tick(ctx, 31);
    const a = answerFunQuiz(ctx, s, { quizId: q.quizId, answerIndex: correctOf(ctx, q.quizId) }).body as B;
    expect(a.correct).toBe(false);
    expect(a.expired).toBe(true);
    const { ctx: c2, s: s2 } = makeCtx();
    startFun(c2, s2, vid(0, "f"));
    tick(c2, 31);
    expect(getState(c2, s2).phase).toBe("studyHall");
  });

  it("is idempotent: start twice returns same quiz; answer twice returns same result", () => {
    const { ctx, s } = makeCtx();
    const q1 = startFun(ctx, s, vid(0, "f")).body as B;
    const q2 = startFunQuiz(ctx, s, { videoId: vid(0, "f"), watchedSeconds: 12, durationSeconds: 15 }).body as B;
    expect(q2.quizId).toBe(q1.quizId);
    expect(startFunQuiz(ctx, s, { videoId: vid(1, "f"), watchedSeconds: 1, durationSeconds: 15 }).status).toBe(409);
    const a1 = answerFunQuiz(ctx, s, { quizId: q1.quizId, answerIndex: correctOf(ctx, q1.quizId) }).body as B;
    const a2 = answerFunQuiz(ctx, s, { quizId: q1.quizId, answerIndex: 99 }).body as B;
    expect(a2.correct).toBe(a1.correct);
    expect(a2.alreadyAnswered).toBe(true);
  });

  it("rejects forged quizId from another session", () => {
    const { ctx, s } = makeCtx();
    const q = startFun(ctx, s, vid(0, "f")).body as B;
    const other = makeCtx();
    expect(answerFunQuiz(ctx, other.s, { quizId: q.quizId, answerIndex: 0 }).status).toBe(404);
    expect(answerFunQuiz(ctx, s, { quizId: "nope", answerIndex: 0 }).status).toBe(404);
  });
});

describe("Study Hall state machine", () => {
  it("enters on wrong answer, blocks feed with 409, and resumes on completion", () => {
    const { ctx, s } = makeCtx();
    const r = failFun(ctx, s);
    expect(r.correct).toBe(false);
    expect(r.study.required).toBe(1);
    expect(r.study.completed).toBe(0);
    expect(r.study.reel.linkId).toBeTruthy();
    const f = feedCurated(ctx, s, "0");
    expect(f.status).toBe(409);
    expect(f.body.error).toBe("StudyHall");
    expect(startFunQuiz(ctx, s, { videoId: vid(1, "f"), watchedSeconds: 1, durationSeconds: 15 }).status).toBe(409);
    // reload resumes reel + attempt
    const st = getState(ctx, s);
    expect(st.phase).toBe("studyHall");
    expect(st.study.reel?.linkId).toBe(r.study.reel.linkId);
    expect(st.study.attempt).toBe(1);
    expect((studyNext(ctx, s).body as B).linkId).toBe(r.study.reel.linkId);
    const a = answerStudy(ctx, s, r.study.reel.linkId, true);
    expect(a.correct).toBe(true);
    expect(a.next).toBe("resume");
    expect(a.resumeAfterVideoId).toBe(vid(0, "f"));
    expect(getState(ctx, s).phase).toBe("free");
    expect(feedCurated(ctx, s, "0").status).toBe(200);
  });

  it("escalates required with consecutive fails and caps at maxRequired", () => {
    const { ctx, s } = makeCtx();
    const req: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = failFun(ctx, s, vid(i, "f"));
      req.push(r.study.required);
      let reel = r.study.reel.linkId;
      for (let k = 0; k < r.study.required; k++) {
        const a = answerStudy(ctx, s, reel, true);
        if (a.next !== "resume") reel = a.next.linkId;
      }
      expect(getState(ctx, s).phase).toBe("free");
    }
    expect(req).toEqual([1, 2, 3, 3]);
    // a correct fun pass resets consecutive fails
    passFun(ctx, s, vid(4, "f"));
    expect(s.consecutive_fun_fails).toBe(0);
    expect(failFun(ctx, s, vid(1, "f")).study.required).toBe(1);
  });

  it("wrong once -> watch again with reshuffled options; wrong twice -> different reel, completed unchanged", () => {
    const { ctx, s } = makeCtx();
    const r = failFun(ctx, s);
    const link = r.study.reel.linkId;
    const q1 = studyQuiz(ctx, s, link).body as B;
    const c1 = correctOf(ctx, q1.quizId);
    const a1 = answerStudyQuiz(ctx, s, { quizId: q1.quizId, answerIndex: (c1 + 1) % 4 }).body as B;
    expect(a1.watchAgain).toBe(true);
    expect(a1.explanation).toBeTruthy();
    expect(getState(ctx, s).study.attempt).toBe(2);
    expect(getState(ctx, s).study.reel?.linkId).toBe(link);
    // must re-watch: wall-clock reset
    expect(startStudyQuiz(ctx, s, { linkId: link, watchedSeconds: 12, durationSeconds: 15 }).body.error).toBe("WatchForged");
    const q2 = studyQuiz(ctx, s, link).body as B;
    expect(q2.attempt).toBe(2);
    expect(q2.options).not.toEqual(q1.options);
    expect([...q2.options].sort()).toEqual([...q1.options].sort());
    const a2 = answerStudyQuiz(ctx, s, { quizId: q2.quizId, answerIndex: (correctOf(ctx, q2.quizId) + 1) % 4 }).body as B;
    expect(a2.watchAgain).toBeUndefined();
    expect(a2.next.linkId).not.toBe(link);
    expect(a2.study.completed).toBe(0);
    expect(getState(ctx, s).phase).toBe("studyHall");
  });

  it("only one edu link: second wrong serves the same link again (no deadlock)", () => {
    const { ctx, s } = makeCtx({ edu: 1 });
    const link = failFun(ctx, s).study.reel.linkId;
    answerStudy(ctx, s, link, false);
    const a = answerStudy(ctx, s, link, false);
    expect(a.next.linkId).toBe(link);
  });

  it("empty edu database never deadlocks", () => {
    const { ctx, s } = makeCtx({ edu: 0 });
    const r = failFun(ctx, s);
    expect(r.correct).toBe(false);
    expect(getState(ctx, s).phase).toBe("free");
  });

  it("escape setting lets the user leave after maxReelsPerVisit (off by default)", () => {
    for (const escape of [false, true]) {
      const { ctx, s } = makeCtx({ config: { studyHallEscape: escape, maxReelsPerVisit: 2 } });
      let link = failFun(ctx, s).study.reel.linkId;
      let last: B = {};
      for (let i = 0; i < 2; i++) {
        answerStudy(ctx, s, link, false);
        last = answerStudy(ctx, s, link, false);
        if (last.next && last.next !== "resume") link = last.next.linkId;
      }
      if (escape) {
        expect(last.next).toBe("resume");
        expect(last.escaped).toBe(true);
        expect(getState(ctx, s).phase).toBe("free");
      } else {
        expect(getState(ctx, s).phase).toBe("studyHall");
      }
    }
  });

  it("unplayable edu reel is replaced and does not count", () => {
    const { ctx, s } = makeCtx();
    const r = failFun(ctx, s);
    const u = markUnplayable(ctx, s, { linkId: r.study.reel.linkId }).body as B;
    expect(u.next.linkId).not.toBe(r.study.reel.linkId);
    expect(getState(ctx, s).study.completed).toBe(0);
    expect(pickEduLink(ctx, s)?.id).not.toBe(r.study.reel.linkId);
  });

  it("study quiz for a different reel is rejected in Study Hall", () => {
    const { ctx, s } = makeCtx();
    const r = failFun(ctx, s);
    const other = Object.values(ctx.store.data.links).find((l) => l.kind === "edu" && l.id !== r.study.reel.linkId)!;
    expect(startStudyQuiz(ctx, s, { linkId: other.id, watchedSeconds: 1, durationSeconds: 15 }).status).toBe(409);
  });
});

describe("credits", () => {
  function earn(ctx: Ctx, s: SessionRow) {
    const reel = studyNext(ctx, s).body as B;
    return answerStudy(ctx, s, reel.linkId, true);
  }

  it("voluntary study earns 1 credit; credit skips a fun quiz", () => {
    const { ctx, s } = makeCtx();
    const a = earn(ctx, s);
    expect(a.creditEarned).toBe(true);
    expect(getState(ctx, s).credits).toBe(1);
    feedCurated(ctx, s, "0");
    const r = startFunQuiz(ctx, s, { videoId: vid(0, "f"), watchedSeconds: 0, durationSeconds: 15 }).body as B;
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe("credit");
    expect(getState(ctx, s).credits).toBe(0);
    const me = getMe(ctx, s).body as B;
    expect(me.creditsEarned).toBe(1);
    expect(me.creditsSpent).toBe(1);
    expect(me.reelsLearned).toBe(1);
  });

  it("credits not consumed when disabled", () => {
    const { ctx, s } = makeCtx();
    earn(ctx, s);
    s.credits_enabled = false;
    expect((startFun(ctx, s, vid(0, "f")).body as B).quizId).toBeTruthy();
    expect(s.credits).toBe(1);
  });

  it("daily cap and 7-day per-link cooldown", () => {
    const { ctx, s } = makeCtx({ edu: 8, config: { creditsPerDay: 5 } });
    const earned: boolean[] = [];
    for (let i = 0; i < 7; i++) earned.push(earn(ctx, s).creditEarned);
    expect(earned.filter(Boolean)).toHaveLength(5);
    // next day: cap resets, but links that earned < 7 days ago don't earn again
    const { ctx: c2, s: s2 } = makeCtx({ edu: 1 });
    expect(earn(c2, s2).creditEarned).toBe(true);
    tick(c2, 86_400);
    expect(earn(c2, s2).creditEarned).toBe(false);
    tick(c2, 7 * 86_400);
    expect(earn(c2, s2).creditEarned).toBe(true);
  });

  it("cannot farm credits while a fun quiz is owed or in Study Hall", () => {
    const { ctx, s } = makeCtx();
    startFun(ctx, s, vid(0, "f"));
    const reel = studyNext(ctx, s).body as B;
    tick(ctx, 12);
    const r = startStudyQuiz(ctx, s, { linkId: reel.linkId, watchedSeconds: 12, durationSeconds: 15 });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("QuizOwed");
    const { ctx: c2, s: s2 } = makeCtx();
    const link = failFun(c2, s2).study.reel.linkId;
    const a = answerStudy(c2, s2, link, true);
    expect(a.creditEarned).toBeFalsy();
    expect(s2.credits).toBe(0);
  });
});

describe("edu selection (least recently seen)", () => {
  it("prefers unseen, then least recently seen, recycles when all seen", () => {
    const { ctx, s } = makeCtx({ edu: 3 });
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = studyNext(ctx, s).body as B;
      seen.add(r.linkId);
      tick(ctx, 1);
    }
    expect(seen.size).toBe(3);
    const first = Object.values(ctx.store.data.link_views).sort((a, b) => a.last_seen_at - b.last_seen_at)[0];
    expect((studyNext(ctx, s).body as B).linkId).toBe(first.link_id);
  });

  it("prefers session topics and falls back to any topic", () => {
    const { ctx, s } = makeCtx({ edu: 3, topics: ["physics", "math", "physics"] });
    for (let i = 0; i < 5; i++) expect(pickEduLink(ctx, s)?.topic).toBe("math");
    s.topics = ["history"];
    expect(pickEduLink(ctx, s)).not.toBeNull();
  });

  it("skips inactive and quizless edu links", () => {
    const { ctx, s } = makeCtx({ edu: 2 });
    const [a, b] = Object.values(ctx.store.data.links).filter((l) => l.kind === "edu");
    a.active = false;
    for (let i = 0; i < 4; i++) expect(pickEduLink(ctx, s)?.id).toBe(b.id);
    b.has_quiz = false;
    expect(pickEduLink(ctx, s)).toBeNull();
  });
});

describe("snapshot on admin edit", () => {
  it("in-flight quiz keeps its question/options/answer after edit or deactivation", () => {
    const { ctx, s, store } = makeCtx();
    const link = failFun(ctx, s).study.reel.linkId;
    const q = studyQuiz(ctx, s, link).body as B;
    const c = correctOf(ctx, q.quizId);
    const correctText = q.options[c];
    const r = adminUpdateLink(store, link, { question: "Edited?", options: ["P", "Q"], correct_index: 0 });
    expect(r.status).toBe(200);
    expect(store.data.quizzes[q.quizId].question).toBe(q.question);
    expect(store.data.quizzes[q.quizId].options[c]).toBe(correctText);
    store.data.links[link].active = false;
    const a = answerStudyQuiz(ctx, s, { quizId: q.quizId, answerIndex: c }).body as B;
    expect(a.correct).toBe(true);
  });
});
