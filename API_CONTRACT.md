# Retention API contract

What the frontend expects from the backend. TypeScript types live in
[`lib/api/types.ts`](lib/api/types.ts) and are the source of truth; this doc
explains them.

The frontend points at the backend with one env var:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

If it's unset, the app runs against an in-memory mock (`lib/api/mock`).

## Conventions

- JSON in, JSON out. camelCase keys.
- Every request sends `X-User-Id: <uuid>`, an anonymous id the browser
  generates once and keeps. Use it to track attempts and stats per user.
- The frontend runs on a different origin, so enable CORS for it and allow the
  `X-User-Id` and `Content-Type` headers.
- Errors return a non-2xx status with:

  ```json
  { "code": "WATCH_REQUIRED", "message": "Watch the whole video first" }
  ```

  `code` is one of `NOT_FOUND`, `WATCH_REQUIRED`, `ALREADY_PASSED`,
  `BAD_REQUEST`, `UNKNOWN`.

## The gate (rules the backend enforces)

1. The client posts a completed watch when the video ends.
2. A quiz attempt is only accepted if there's been a completed watch since the
   user's last attempt on that video. Otherwise `409 WATCH_REQUIRED`.
3. A wrong answer resets that, so the user has to watch the full video again.
4. Never send the correct answer to the client: not in the quiz payload,
   and not in the response to a wrong attempt.

## Endpoints

### `GET /shorts?cursor=&limit=4` → `FeedPage`

```json
{
  "items": [Short],
  "nextCursor": "4"
}
```

`nextCursor: null` means the feed is over. The cursor format is up to you
(opaque to the frontend).

`Short` maps almost 1:1 to the Apify YouTube Shorts Scraper output:

| Field | From Apify | Notes |
| --- | --- | --- |
| `id` | `id` | YouTube video id. Used for the embed player |
| `url` | `url` | |
| `title` | `title` | |
| `thumbnailUrl` | `thumbnailUrl` | Vertical thumbnail preferred (`https://i.ytimg.com/vi/{id}/oardefault.jpg`) |
| `durationSeconds` | `duration` | Convert `"00:00:26"` → `26` |
| `viewCount` | `viewCount` | |
| `likes` | `likes` | |
| `commentsCount` | `commentsCount` | |
| `date` | `date` | ISO 8601 |
| `channelName` | `channelName` | |
| `channelUsername` | `channelUsername` | |
| `channelAvatarUrl` | `channelAvatarUrl` | nullable |
| `isChannelVerified` | `isChannelVerified` | |
| `hashtags` | `hashtags` | strings without `#` |
| `likedByMe` | — | Per-user, from your DB |

Only return shorts that have a quiz. Shorts that are age-restricted or
members-only (`isAgeRestricted`, `isMembersOnly`) won't embed, so skip those.

### `GET /shorts/:id/quiz` → `Quiz`

```json
{
  "id": "quiz-abc",
  "videoId": "-kwF6M4juiU",
  "question": "Why did Newton include indigo as a color of the rainbow?",
  "options": [
    { "id": "opt-0", "text": "…" },
    { "id": "opt-1", "text": "…" },
    { "id": "opt-2", "text": "…" },
    { "id": "opt-3", "text": "…" }
  ]
}
```

One multiple-choice question, 4 options, generated from the transcript.
Shuffling the option order on each request is encouraged.

> Heads-up: the Apify actor only reports whether subtitles exist; `subtitles`
> is often `null`. You'll likely need a separate transcript source to
> generate quizzes.

### `POST /shorts/:id/quiz/attempts` → `QuizAttemptResult`

Body: `{ "quizId": "quiz-abc", "optionId": "opt-2" }`

```json
{
  "correct": false,
  "attemptNumber": 2,
  "explanation": null,
  "stats": { "passed": 3, "failed": 5, "secondsRewatched": 212, "streak": 0 }
}
```

`explanation` is a one-line "why" shown only when `correct` is `true`.
On a miss, add the video's duration to `secondsRewatched` and reset `streak`.
`streak` counts consecutive first-try passes.

Errors: `409 WATCH_REQUIRED`, `409 ALREADY_PASSED`, `400 BAD_REQUEST`.

### `POST /shorts/:id/watches` → `204`

Body: `{ "completed": true, "secondsWatched": 31 }`

The frontend sends this when playback ends. `completed: true` unlocks the next
quiz attempt.

### `PUT /shorts/:id/like` → `LikeResult`

Body: `{ "liked": true }` → `{ "liked": true, "likes": 14201 }`

### `GET /shorts/:id/comments` → `Comment[]`

Newest first.

```json
[
  {
    "id": "c1",
    "videoId": "-kwF6M4juiU",
    "authorName": "Priya K.",
    "authorAvatarUrl": null,
    "text": "…",
    "likes": 877,
    "createdAt": "2026-10-16T09:12:00.000Z",
    "isMine": false
  }
]
```

### `POST /shorts/:id/comments` → `Comment`

Body: `{ "text": "…" }` (1–500 chars). Returns the created comment with
`isMine: true`.

### `GET /me/stats` → `UserStats`

```json
{ "passed": 3, "failed": 5, "secondsRewatched": 212, "streak": 0 }
```
