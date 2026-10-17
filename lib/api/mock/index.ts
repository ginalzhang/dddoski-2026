import { ApiError, type Comment, type Quiz, type RetentionApi, type Short, type UserStats } from '@/lib/api/types';
import { genres, quizzes, shorts } from '@/lib/api/mock/data';
import { seedCommentsFor } from '@/lib/api/mock/seed';

// The app's data layer. Shorts and quizzes come from data/quizzes.json (see
// ./data.ts); progress, likes and comments live in memory for the tab's
// lifetime. Calls wait a little so loading states are visible.

const LATENCY_MS: [number, number] = [180, 520];

function delay() {
    const [min, max] = LATENCY_MS;
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

type VideoProgress = {
    attempts: number;
    passed: boolean;
    /** Must be true before an attempt is accepted. Reset after a miss. */
    watchedSinceLastAttempt: boolean;
};

const db = {
    shorts: new Map<string, Short>(shorts.map((s) => [s.id, { ...s }])),
    order: shorts.map((s) => s.id),
    quizzes: new Map(quizzes.map((q) => [q.videoId, q])),
    comments: new Map<string, Comment[]>(),
    progress: new Map<string, VideoProgress>(),
    stats: { passed: 0, failed: 0, secondsRewatched: 0, streak: 0 } as UserStats,
};

function getShort(videoId: string) {
    const short = db.shorts.get(videoId);
    if (!short) throw new ApiError('NOT_FOUND', `No short with id ${videoId}`, 404);
    return short;
}

// The data file only has URLs, so title and channel come from YouTube's
// oEmbed endpoint (CORS-enabled). Cached per video; failures keep placeholders.
const enriched = new Map<string, Promise<void>>();

function enrichShort(short: Short) {
    let job = enriched.get(short.id);
    if (!job) {
        job = fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(short.url)}`, { signal: AbortSignal.timeout(3000) })
            .then((r) => (r.ok ? r.json() : null))
            .then((o: { title?: string; author_name?: string; author_url?: string } | null) => {
                if (!o) return;
                if (o.title) short.title = o.title;
                if (o.author_name) short.channelName = o.author_name;
                const handle = o.author_url?.match(/\/@([^/?#]+)/)?.[1];
                short.channelUsername = handle ?? o.author_name ?? short.channelUsername;
            })
            .catch(() => {});
        enriched.set(short.id, job);
    }
    return job;
}

function getProgress(videoId: string) {
    let p = db.progress.get(videoId);
    if (!p) {
        p = { attempts: 0, passed: false, watchedSinceLastAttempt: false };
        db.progress.set(videoId, p);
    }
    return p;
}

function getCommentList(videoId: string) {
    let list = db.comments.get(videoId);
    if (!list) {
        list = seedCommentsFor(videoId, Date.now());
        db.comments.set(videoId, list);
    }
    return list;
}

export const mockApi: RetentionApi = {
    async getFeed({ cursor, limit = 4, genre } = {}) {
        await delay();
        const order = genre ? db.order.filter((id) => getShort(id).genre === genre) : db.order;
        const start = cursor ? Number(cursor) : 0;
        const ids = order.slice(start, start + limit);
        await Promise.all(ids.map((id) => enrichShort(getShort(id))));
        const next = start + limit;
        return {
            items: ids.map((id) => ({ ...getShort(id) })),
            nextCursor: next < order.length ? String(next) : null,
        };
    },

    async getGenres() {
        await delay();
        return genres.map((g) => ({ ...g, count: db.order.filter((id) => getShort(id).genre === g.id).length }));
    },

    async getQuiz(videoId) {
        await delay();
        getShort(videoId);
        const seed = db.quizzes.get(videoId);
        if (!seed) throw new ApiError('NOT_FOUND', 'No quiz for this short yet', 404);
        const quiz: Quiz = {
            id: `quiz-${videoId}`,
            videoId,
            question: seed.question,
            // Reshuffled per request so a retry can't be passed on muscle memory.
            options: shuffle(seed.options.map((text, i) => ({ id: `opt-${i}`, text }))),
        };
        return quiz;
    },

    async submitQuizAttempt(videoId, { quizId, optionId }) {
        await delay();
        const short = getShort(videoId);
        const seed = db.quizzes.get(videoId);
        if (!seed || quizId !== `quiz-${videoId}`) {
            throw new ApiError('BAD_REQUEST', 'Quiz does not match this short', 400);
        }
        const progress = getProgress(videoId);
        if (progress.passed) {
            throw new ApiError('ALREADY_PASSED', 'You already passed this one', 409);
        }
        if (!progress.watchedSinceLastAttempt) {
            throw new ApiError('WATCH_REQUIRED', 'Watch the whole video first', 409);
        }

        progress.attempts += 1;
        progress.watchedSinceLastAttempt = false;
        const correct = optionId === `opt-${seed.correctIndex}`;

        if (correct) {
            progress.passed = true;
            db.stats.passed += 1;
            db.stats.streak = progress.attempts === 1 ? db.stats.streak + 1 : 0;
        } else {
            db.stats.failed += 1;
            db.stats.streak = 0;
            db.stats.secondsRewatched += short.durationSeconds;
        }

        return {
            correct,
            attemptNumber: progress.attempts,
            explanation: null,
            stats: { ...db.stats },
        };
    },

    async recordWatch(videoId, { completed, secondsWatched }) {
        await delay();
        const short = getShort(videoId);
        // The data file has no durations; the player reports them here.
        if (secondsWatched > 0) short.durationSeconds = Math.round(secondsWatched);
        if (completed) getProgress(videoId).watchedSinceLastAttempt = true;
    },

    async setLike(videoId, liked) {
        await delay();
        const short = getShort(videoId);
        if (short.likedByMe !== liked) {
            short.likes += liked ? 1 : -1;
            short.likedByMe = liked;
        }
        return { liked: short.likedByMe, likes: short.likes };
    },

    async getComments(videoId) {
        await delay();
        getShort(videoId);
        return [...getCommentList(videoId)];
    },

    async postComment(videoId, text) {
        await delay();
        const short = getShort(videoId);
        const trimmed = text.trim();
        if (!trimmed) throw new ApiError('BAD_REQUEST', "Comment can't be empty", 400);
        const comment: Comment = {
            id: `${videoId}-${Date.now()}`,
            videoId,
            authorName: 'You',
            authorAvatarUrl: null,
            text: trimmed.slice(0, 500),
            likes: 0,
            createdAt: new Date().toISOString(),
            isMine: true,
        };
        getCommentList(videoId).unshift(comment);
        short.commentsCount += 1;
        return comment;
    },

    async getStats() {
        await delay();
        return { ...db.stats };
    },
};
