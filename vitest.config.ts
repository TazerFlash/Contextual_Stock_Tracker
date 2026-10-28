import { defineConfig } from "vitest/config";

export default defineConfig({
  // The React Native app in app/ has its own tooling; only run the engine tests here.
  test: { include: ["tests/**/*.test.ts"] },
});
