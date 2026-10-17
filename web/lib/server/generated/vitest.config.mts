// Temporary local config (used only if web/vitest.config.ts is absent).
import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  root: path.resolve(__dirname, "../../.."),
  resolve: { alias: { "@": path.resolve(__dirname, "../../..") } },
  test: { include: ["tests/unit/generated*.test.ts"], environment: "node" },
});
