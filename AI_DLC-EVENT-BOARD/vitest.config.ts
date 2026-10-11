import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/c1-foundation/**/*.test.ts"],
    // Stack synthesis also bundles the C3 Lambda functions.
    testTimeout: 120000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/lambda/**/*.ts", "src/seed/**/*.ts"],
      // C3 handlers are measured by test/c3-event-apis/vitest.config.ts, the
      // C4 web-deployment handler by test/c4-ui/vitest.config.ts, and the C5
      // handlers by test/c5-reminders-statistics-archival/vitest.config.ts.
      exclude: [
        "src/seed/cli.ts",
        "src/lambda/event-public/**",
        "src/lambda/event-management/**",
        "src/lambda/rsvp/**",
        "src/lambda/web-deploy/**",
        "src/lambda/reminder-selector/**",
        "src/lambda/reminder-worker/**",
        "src/lambda/admin-stats/**",
        "src/lambda/archival/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 80,
      },
    },
  },
});
