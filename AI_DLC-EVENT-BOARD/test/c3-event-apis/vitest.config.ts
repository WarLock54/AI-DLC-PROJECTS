import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C3 keeps its own config so the C1 and C2 configs stay unchanged. The root is
// pinned to the repository so include/coverage globs resolve the same way
// regardless of where the config file lives.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    environment: "node",
    include: ["test/c3-event-apis/**/*.test.ts"],
    // CDK synthesis bundles four Lambda functions; allow for slower CI runners.
    testTimeout: 120000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      // C3 backend business logic: RSVP/waitlist, event management, discovery,
      // banner policy, access control, and the HTTP boundary helpers, plus the
      // thin C3 Lambda entry points exercised through their exported handlers.
      include: [
        "src/event-api/**/*.ts",
        "src/lambda/event-public/**/*.ts",
        "src/lambda/event-management/**/*.ts",
        "src/lambda/rsvp/**/*.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/c3-event-apis",
      thresholds: {
        lines: 80,
      },
    },
  },
});
