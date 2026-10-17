# Live check against real YouTube embeds

The automated tests use a fake `YT.Player`. This checklist is the manual pass against real embeds. Run it in desktop Chrome and on an iOS Safari phone (to check inline playback).

Setup: `npm run seed && npm run seed:verify && npm run dev` with `FUN_FEED_MODE=curated`. Open http://localhost:3000.

## 1. Fun feed with a real embed
- [ ] The first Short plays only after you click (autoplay rules). The YouTube logo and title link are visible and nothing covers the iframe.
- [ ] Press Next before reaching `MIN_WATCH_FRACTION`: a "keep watching" toast appears and no quiz starts.
- [ ] Watch past the threshold and press Next: the video pauses and mutes, the iframe is hidden (check in DevTools that it is not covered), and the quiz panel takes its place.
- [ ] Answer correctly: the next Short loads. In the Network tab, `/api/feed` never returned more than 3 IDs.
- [ ] Answer wrongly: you land in Study Hall. `curl -b <cookie> localhost:3000/api/feed` returns `409`.

## 2. Three real math reels from the seed
Use `/admin` (or temporarily deactivate the other links) so that these come up in Study Hall or `/study`:
- [ ] `v1P1X-r0vPQ`, "Ramanujan Nested Radicals" (Andy Math). It plays inline, and the quiz answer is **3**.
- [ ] `bnjKwiUg-kw`, "The dynamics of e^(πi)" (3Blue1Brown). It plays, and the quiz answer is **-1**.
- [ ] `Y0O8VKuIEQ4`, "Pizza proof 0.999... = 1" (MindYourDecisions). It plays, and the quiz answer is **Exactly 1**.
- [ ] For each reel: a wrong answer shows the explanation and "Watch again", the same reel replays, and the options are reshuffled. A second wrong answer moves to a different reel.
- [ ] Reload mid-reel: the same reel and attempt number come back. A second browser profile with the same cookie shows the same Study Hall state.
- [ ] Meet the requirement: you are returned to the fun feed at the Short after the one you failed.

## 3. Embedding-disabled video
No embedding-disabled Short was found while the seed was built: every candidate returned oEmbed 200. To find one:
1. Pick a candidate. Official music videos from some labels and some sports-league or broadcaster clips often block embedding.
2. Run `curl -s -o /dev/null -w "%{http_code}" "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=<ID>&format=json"`. A **401** (or 403) means embedding is disabled. Alternatively, with `YOUTUBE_API_KEY`, `videos.list?part=status` shows `status.embeddable=false`.
3. Add it as an edu link through `/admin` with `active: true`.
- [ ] `npm run seed:verify` (or the admin "verify embeddable" button) flags it as `embedding disabled`.
- [ ] If it is still served, the player fires `onError` 101/150. The app marks the link unplayable, serves another reel, and does **not** count it toward `required`.
- [ ] With it as the *only* active edu link, Study Hall does not deadlock: it shows an empty-database or escape message as documented.

## 4. Compliance spot-check
- [ ] Only one player exists in the DOM at a time.
- [ ] No click or hover handlers are attached on top of the iframe.
- [ ] The player is at least 200x200 px.
- [ ] No video bytes are requested from googlevideo.com by our server (check the server logs and the Network tab).

Record the date, browser and result for each item when you run this.
