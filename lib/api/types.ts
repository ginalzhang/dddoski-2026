// Shared API contract between the Retention frontend and backend.
// Field names on `Short` mirror the Apify "YouTube Shorts Scraper" output
// (streamers/youtube-shorts-scraper) so the backend can pass items through.
// See API_CONTRACT.md for the HTTP endpoints.

export type Short = {
    /** YouTube video id, e.g. "gnuiMgTzKMQ" (Apify: `id`) */
    id: string;
    /** https://www.youtube.com/shorts/{id} (Apify: `url`) */
    url: string;
    title: string;
    thumbnailUrl: string;
    /** Seconds. Apify returns "00:00:26"; backend should convert. */
    durationSeconds: number;
    viewCount: number;
    likes: number;
    commentsCount: number;
    /** ISO 8601 (Apify: `date`) */
    date: string;
    channelName: string;
    channelUsername: string;
    channelAvatarUrl: string | null;
    isChannelVerified: boolean;
    hashtags: string[];
    /** Genre id this short is filed under, e.g. "physics". See `Genre`. */
    genre: string;
    /** Whether the current user has liked this short. */
    likedByMe: boolean;
};

export type FeedPage = {
    items: Short[];
    /** Pass back as `cursor` to get the next page. `null` = end of feed. */
    nextCursor: string | null;
};

export type Genre = {
    /** Stable id, passed back as `genre` on `getFeed`. */
    id: string;
    label: string;
    /** How many shorts are filed under it. */
    count: number;
};

export type QuizOption = {
    id: string;
    text: string;
};

/** The correct answer is intentionally NOT included. Grading is server-side. */
export type Quiz = {
    id: string;
    videoId: string;
    question: string;
    options: QuizOption[];
};

export type QuizAttemptRequest = {
    quizId: string;
    optionId: string;
};

export type QuizAttemptResult = {
    correct: boolean;
    /** 1-based attempt number for this user + video. */
    attemptNumber: number;
    /** Only present when `correct` is true. Never reveal the answer on a miss. */
    explanation: string | null;
    stats: UserStats;
};

export type WatchEvent = {
    /** True when playback reached the end. */
    completed: boolean;
    secondsWatched: number;
};

export type LikeResult = {
    liked: boolean;
    likes: number;
};

export type Comment = {
    id: string;
    videoId: string;
    authorName: string;
    authorAvatarUrl: string | null;
    text: string;
    likes: number;
    /** ISO 8601 */
    createdAt: string;
    isMine: boolean;
};

export type UserStats = {
    passed: number;
    failed: number;
    /** Total seconds the user has been forced to rewatch. */
    secondsRewatched: number;
    /** Consecutive first-try passes. */
    streak: number;
};

export type ApiErrorCode = 'NOT_FOUND' | 'WATCH_REQUIRED' | 'ALREADY_PASSED' | 'BAD_REQUEST' | 'NETWORK' | 'UNKNOWN';

export class ApiError extends Error {
    constructor(
        public code: ApiErrorCode,
        message: string,
        public status?: number,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export interface RetentionApi {
    /** `genre` filters the feed to one genre id; omit or `null` for everything. */
    getFeed(params?: { cursor?: string | null; limit?: number; genre?: string | null }): Promise<FeedPage>;
    getGenres(): Promise<Genre[]>;
    getQuiz(videoId: string): Promise<Quiz>;
    submitQuizAttempt(videoId: string, body: QuizAttemptRequest): Promise<QuizAttemptResult>;
    recordWatch(videoId: string, body: WatchEvent): Promise<void>;
    setLike(videoId: string, liked: boolean): Promise<LikeResult>;
    getComments(videoId: string): Promise<Comment[]>;
    postComment(videoId: string, text: string): Promise<Comment>;
    getStats(): Promise<UserStats>;
}
