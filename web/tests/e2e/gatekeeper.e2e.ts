/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "@playwright/test";
import { answerQuiz, failIntoStudyHall, getLinks, openFeed, setup, takeEduQuiz, waitWatched } from "./helpers";

test.beforeEach(async ({ page }) => {
  await setup(page);
});

test("first play requires a click", async ({ page }) => {
  await page.goto("/");
  const player = page.getByTestId("player");
  await expect(player).toBeVisible();
  await expect(player).not.toHaveAttribute("data-video-id", "");
  await page.waitForTimeout(600);
  const before = await page.evaluate(() => (window as any).__FAKE_YT_LOG__.map((e: any) => e.name));
  expect(before).toContain("cueVideoById");
  expect(before).not.toContain("playVideo");
  expect(before).not.toContain("loadVideoById");
  await expect(page.getByTestId("watched")).toHaveText(/Watched 0\.0s/);
  await page.getByTestId("play").click();
  await waitWatched(page, 0.5);
  expect(await page.evaluate(() => (window as any).__FAKE_YT_PLAYERS__)).toBe(1);
});

test("min-watch toast (client and server)", async ({ page }) => {
  const items = await openFeed(page);
  await page.getByTestId("next").click();
  await expect(page.getByTestId("toast")).toHaveText("Finish the Short first");
  await expect(page.getByTestId("quiz-panel")).toHaveCount(0);
  const status = await page.evaluate(async (videoId) => {
    const r = await fetch("/api/quiz/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, direction: "next", watchedSeconds: 0.1, durationSeconds: 2 }),
    });
    return r.status;
  }, items[0].videoId);
  expect(status).toBe(400);
});

test("quiz replaces the player and correct answer advances", async ({ page, request }) => {
  const links = await getLinks(request);
  const items = await openFeed(page);
  await waitWatched(page, 2.2);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("quiz-panel")).toBeVisible();
  await expect(page.getByTestId("player")).toBeHidden();
  const log = await page.evaluate(() => (window as any).__FAKE_YT_LOG__.map((e: any) => e.name));
  expect(log).toContain("pauseVideo");
  expect(log).toContain("mute");
  await answerQuiz(page, links, true);
  await expect(page.getByTestId("quiz-panel")).toHaveCount(0);
  await expect(page.getByTestId("player")).toBeVisible();
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", items[1].videoId);
});

test("wrong answer enters Study Hall and the feed returns 409", async ({ page, request }) => {
  const links = await getLinks(request);
  await openFeed(page);
  await failIntoStudyHall(page, links);
  await expect(page.getByTestId("study-status")).toContainText("Study Hall");
  const r = await page.evaluate(async () => {
    const res = await fetch("/api/feed");
    return { status: res.status, body: await res.json() };
  });
  expect(r.status).toBe(409);
  expect(r.body.error).toBe("StudyHall");
});

test("edu reel correct returns to the fun feed at the right Short", async ({ page, request }) => {
  const links = await getLinks(request);
  const items = await openFeed(page);
  await failIntoStudyHall(page, links);
  await takeEduQuiz(page);
  await answerQuiz(page, links, true);
  await expect(page.getByTestId("study-panel")).toBeVisible();
  await expect(page.getByTestId("player")).toBeHidden();
  await expect(page.getByTestId("explanation")).not.toBeEmpty();
  await page.getByTestId("back-to-feed").click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-kind", "fun");
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", items[1].videoId);
});

test("edu wrong shows explanation and watch again", async ({ page, request }) => {
  const links = await getLinks(request);
  await openFeed(page);
  await failIntoStudyHall(page, links);
  const reel = await page.getByTestId("player").getAttribute("data-video-id");
  await takeEduQuiz(page);
  await answerQuiz(page, links, false);
  await expect(page.getByTestId("explanation")).not.toBeEmpty();
  await page.getByTestId("watch-again").click();
  await expect(page.getByTestId("player")).toBeVisible();
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", reel!);
  await takeEduQuiz(page);
  await expect(page.getByTestId("quiz-panel")).toContainText("attempt 2");
});

test("Study Hall survives reload and shows in a second page", async ({ page, context, request }) => {
  const links = await getLinks(request);
  await openFeed(page);
  await failIntoStudyHall(page, links);
  const reel = await page.getByTestId("player").getAttribute("data-video-id");
  await page.reload();
  await expect(page.getByTestId("player")).toHaveAttribute("data-kind", "edu");
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", reel!);
  const page2 = await context.newPage();
  await setup(page2);
  await page2.goto("/");
  await expect(page2.getByTestId("player")).toHaveAttribute("data-kind", "edu");
  await expect(page2.getByTestId("player")).toHaveAttribute("data-video-id", reel!);
  await expect(page2.getByTestId("next")).toBeVisible();
});

test("unplayable edu link is skipped", async ({ page, request }) => {
  const links = await getLinks(request);
  await openFeed(page);
  await failIntoStudyHall(page, links);
  const reel = (await page.getByTestId("player").getAttribute("data-video-id"))!;
  await page.evaluate((id) => localStorage.setItem("__FAKE_YT_ERROR_IDS__", JSON.stringify([id])), reel);
  const unplayable = page.waitForRequest((r) => r.url().includes("/api/video/unplayable"));
  await page.reload();
  const req = await unplayable;
  expect(req.postDataJSON()).toHaveProperty("linkId");
  await expect(page.getByTestId("player")).toHaveAttribute("data-kind", "edu");
  await expect(page.getByTestId("player")).not.toHaveAttribute("data-video-id", reel);
  await page.evaluate(() => localStorage.removeItem("__FAKE_YT_ERROR_IDS__"));
});

test("voluntary /study earns a credit and the credit skips a fun quiz", async ({ page, request }) => {
  const links = await getLinks(request);
  await page.goto("/study");
  await expect(page.getByTestId("player")).toHaveAttribute("data-kind", "edu");
  await page.getByTestId("play").click();
  await takeEduQuiz(page);
  await answerQuiz(page, links, true);
  await expect(page.getByTestId("credit-earned")).toHaveText("+1 Brain Credit");
  await expect(page.getByTestId("credits-count")).toHaveText("1");

  const items = await openFeed(page);
  await waitWatched(page, 2.2);
  await page.getByTestId("next").click();
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", items[1].videoId);
  await expect(page.getByTestId("quiz-panel")).toHaveCount(0);
  await expect(page.getByTestId("credits-count")).toHaveText("0");
});

test("admin CSV import reports the bad row", async ({ page }) => {
  await page.goto("/admin");
  await page.getByTestId("admin-password").fill("test");
  await page.getByTestId("admin-login").click();
  await expect(page.getByTestId("links-table")).toBeVisible();
  const csv = [
    "kind,video_id_or_url,title,topic,difficulty,question,option1,option2,option3,option4,correct_index,explanation",
    "edu,https://www.youtube.com/shorts/AAAAAAAAAA1,CSV one,math,1,CSV question one?,1,2,3,4,0,Because one.",
    "edu,https://youtu.be/AAAAAAAAAA2,CSV two,math,2,CSV question two?,a,b,c,,1,Because b.",
    "edu,AAAAAAAAAA3,CSV bad,math,1,CSV bad question?,x,y,,,5,Out of range.",
  ].join("\n");
  await page.getByTestId("csv-input").fill(csv);
  await page.getByTestId("csv-import").click();
  await expect(page.getByTestId("imported-count")).toHaveText("2");
  await expect(page.getByTestId("rejected-row")).toHaveCount(1);
  await expect(page.getByTestId("rejected-row")).toContainText("Line 4");
});
