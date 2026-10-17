import type { Short } from '@/lib/api/types';
import rows from '@/data/quizzes.json';

// Loads data/quizzes.json, the output of the transcript → question pipeline.
// One row per short:
//   { url, question, answer_1..answer_4, correct_answer }
// `correct_answer` may be the answer's text or its key ("answer_2").
// Optional `genre` (e.g. "physics") turns on the genre chips.
// Rows that don't validate are skipped with a console warning.

export type QuizRow = {
    url: string;
    question: string;
    answer_1: string;
    answer_2: string;
    answer_3: string;
    answer_4: string;
    correct_answer: string;
    genre?: string;
};

export type StoredQuiz = {
    videoId: string;
    question: string;
    options: string[];
    correctIndex: number;
};

const ANSWER_KEYS = ['answer_1', 'answer_2', 'answer_3', 'answer_4'] as const;

/** Pulls the 11-char id out of shorts/, watch?v=, youtu.be/ and embed/ URLs. */
export function videoIdFromUrl(url: string): string | null {
    const m = url.match(/(?:shorts\/|[?&]v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
}

function correctIndexOf(row: QuizRow): number {
    const key = row.correct_answer.trim();
    const byKey = ANSWER_KEYS.indexOf(key as (typeof ANSWER_KEYS)[number]);
    if (byKey !== -1) return byKey;
    return ANSWER_KEYS.findIndex((k) => row[k].trim() === key);
}

// Stable fake engagement numbers so the action rail isn't all zeros.
function hash(s: string) {
    let h = 2166136261;
    for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
}

function shortFor(id: string, genre: string): Short {
    const h = hash(id);
    return {
        id,
        url: `https://www.youtube.com/shorts/${id}`,
        // Title and channel are filled in from YouTube oEmbed at load time;
        // duration comes from the player. See `enrichShort` in ./index.ts.
        title: 'YouTube Short',
        thumbnailUrl: `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
        durationSeconds: 0,
        viewCount: 50_000 + (h % 4_950_000),
        likes: 2_000 + (h % 240_000),
        commentsCount: 40 + (h % 3_000),
        date: new Date().toISOString(),
        channelName: 'YouTube',
        channelUsername: 'youtube',
        channelAvatarUrl: null,
        isChannelVerified: false,
        hashtags: genre ? [genre] : [],
        genre,
        likedByMe: false,
    };
}

export const shorts: Short[] = [];
export const quizzes: StoredQuiz[] = [];

for (const [i, raw] of (rows as Partial<QuizRow>[]).entries()) {
    const row = raw as QuizRow;
    const missing = ['url', 'question', ...ANSWER_KEYS, 'correct_answer'].filter((k) => typeof row[k as keyof QuizRow] !== 'string' || !row[k as keyof QuizRow]);
    const id = typeof row.url === 'string' ? videoIdFromUrl(row.url) : null;
    const correctIndex = missing.length ? -1 : correctIndexOf(row);

    if (missing.length || !id || correctIndex === -1) {
        const why = missing.length ? `missing ${missing.join(', ')}` : !id ? `can't read a video id from "${row.url}"` : 'correct_answer matches none of answer_1..answer_4';
        console.warn(`[data/quizzes.json] skipping row ${i}: ${why}`);
        continue;
    }
    if (shorts.some((s) => s.id === id)) {
        console.warn(`[data/quizzes.json] skipping row ${i}: duplicate video ${id}`);
        continue;
    }

    const genre = typeof row.genre === 'string' ? row.genre.trim().toLowerCase() : '';
    shorts.push(shortFor(id, genre));
    quizzes.push({
        videoId: id,
        question: row.question.trim(),
        options: ANSWER_KEYS.map((k) => row[k].trim()),
        correctIndex,
    });
}

/** Genre chips derived from the data; empty when no row has a `genre`. */
export const genres = [...new Set(shorts.map((s) => s.genre).filter(Boolean))].map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
}));
