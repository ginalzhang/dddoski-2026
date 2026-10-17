import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Use the bundled browser if installed; otherwise fall back to the newest cached headless shell.
function fallbackChromium(): string | undefined {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  try {
    const dirs = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of dirs) {
      for (const sub of fs.readdirSync(path.join(cache, d))) {
        const bin = path.join(cache, d, sub, "chrome-headless-shell");
        if (fs.existsSync(bin)) return bin;
      }
    }
  } catch {}
  return undefined;
}
let executablePath: string | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { chromium } = require("@playwright/test");
  if (!fs.existsSync(chromium.executablePath())) executablePath = fallbackChromium();
} catch {
  executablePath = fallbackChromium();
}

const PORT = 3107;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.e2e\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FUN_FEED_MODE: "curated",
      ADMIN_PASSWORD: "test",
      APIFY_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      YOUTUBE_API_KEY: "",
      STORE_PERSIST: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
