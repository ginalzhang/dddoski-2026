// Shared contract between server (lib/server, app/api) and client (components, app pages).
// Do not change shapes without updating both sides.

export type Phase = "free" | "quizOwed" | "studyHall" | "study";
export type Direction = "next" | "prev";

export interface StudyState {
  required: number;
  completed: number;
  reel?: EduReel | null; // current edu reel while in Study Hall
  attempt?: number; // 1 or 2 on current reel
}

export interface EduReel {
  linkId: string;
  videoId: string;
  title: string;
  topic: string;
}

export interface FunItem {
  videoId: string;
  title: string;
}

export interface PublicQuiz {
  quizId: string;
  question: string;
  options: string[]; // shuffled; correct index NEVER sent
  expiresAt: string; // ISO
  attempt?: number;
  kind: "fun" | "edu";
}

export interface StateResponse {
  phase: Phase;
  study: StudyState;
  credits: number;
  creditsEnabled: boolean;
  pendingQuiz?: PublicQuiz | null;
  resumeAfterVideoId?: string | null;
}

// GET /api/feed?cursor=  -> 200 FeedResponse | 409 { error: "StudyHall"|"QuizOwed", phase, study }
export interface FeedResponse {
  items: FunItem[]; // at most 3
  cursor: string | null;
}

// Seed file row (seed/edu-links.json and seed/fun-links.json are arrays of these)
export interface SeedLink {
  kind: "fun" | "edu";
  video_id: string;
  url: string;
  title: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  question: string;
  options: string[]; // 2..4 distinct non-empty
  correct_index: number;
  explanation: string;
  active: boolean;
  duration_s?: number | null;
  embeddable?: boolean | null;
  comment?: string; // e.g. why inactive
}
