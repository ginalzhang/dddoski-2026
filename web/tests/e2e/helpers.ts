import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { installFakeYT } from "./fake-yt";

export interface Link {
  id: string;
  kind: "fun" | "edu";
  video_id: string;
  question: string;
  options: string[];
  correct_index: number;
}

export async function getLinks(request: APIRequestContext): Promise<Link[]> {
  const r = await request.get("/api/admin/links", { headers: { "x-admin-password": "test" } });
  expect(r.ok()).toBeTruthy();
  const d = await r.json();
  return Array.isArray(d) ? d : d.links;
}

export async function setup(page: Page) {
  await installFakeYT(page);
}

/** Open the fun feed, capture the first feed page, and start playback. */
export async function openFeed(page: Page) {
  const feedResp = page.waitForResponse((r) => r.url().includes("/api/feed") && r.request().method() === "GET");
  await page.goto("/");
  const items = (await (await feedResp).json()).items as { videoId: string }[];
  await expect(page.getByTestId("player")).toHaveAttribute("data-video-id", items[0].videoId);
  await page.getByTestId("play").click();
  return items;
}

export async function waitWatched(page: Page, seconds: number) {
  await expect
    .poll(async () => parseFloat(((await page.getByTestId("watched").textContent()) ?? "").replace(/[^\d.]/g, "")), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(seconds);
}

/** Answer the visible quiz correctly or incorrectly using the admin links list. */
export async function answerQuiz(page: Page, links: Link[], correct: boolean) {
  const panel = page.getByTestId("quiz-panel");
  await expect(panel).toBeVisible();
  const q = (await page.getByTestId("quiz-question").textContent())!.trim();
  const link = links.find((l) => l.question.trim() === q);
  expect(link, `no link for question: ${q}`).toBeTruthy();
  const right = link!.options[link!.correct_index];
  const n = await page.locator('[data-testid^="option-"]').count();
  for (let i = 0; i < n; i++) {
    const t = ((await page.getByTestId(`option-${i}`).textContent()) ?? "").replace(/^\s*\d+\./, "").trim();
    if ((t === right) === correct) {
      await page.getByTestId(`option-${i}`).click();
      return link!;
    }
  }
  throw new Error("option not found");
}

/** From a playing fun Short: watch, press Next, answer wrong -> Study Hall. */
export async function failIntoStudyHall(page: Page, links: Link[]) {
  await waitWatched(page, 2.2);
  await page.getByTestId("next").click();
  await answerQuiz(page, links, false);
  await expect(page.getByTestId("player")).toHaveAttribute("data-kind", "edu");
  await expect(page.getByTestId("player")).toBeVisible();
}

export async function takeEduQuiz(page: Page) {
  // Study Hall reel may need a click to start after reload
  const play = page.getByTestId("play");
  if (await play.isVisible()) await play.click();
  await expect(page.getByTestId("take-quiz")).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId("take-quiz").click();
  await expect(page.getByTestId("quiz-panel")).toBeVisible();
}
