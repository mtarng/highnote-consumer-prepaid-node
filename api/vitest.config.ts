import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // One test file per process so each file gets a fresh in-memory SQLite
    // and a fresh module graph (vi.mock isolation, no shared singletons).
    pool: "forks",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: ":memory:",
      JWT_SECRET: "test-jwt-secret-please-do-not-use-in-prod",
      HIGHNOTE_API_KEY: "test-key-mocked",
      HIGHNOTE_ENVIRONMENT: "test",
      LOG_LEVEL: "silent",
    },
  },
});
