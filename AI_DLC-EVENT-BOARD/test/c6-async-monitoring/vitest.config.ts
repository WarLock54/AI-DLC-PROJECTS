import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C6 keeps its own config so C1's root vitest.config.ts stays unchanged.
// The root is pinned to the repository so include/coverage globs resolve the
// same way regardless of where the config file lives.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    environment: "node",
    include: ["test/c6-async-monitoring/**/*.test.ts"],
    testTimeout: 60000,
    // The whole-app cdk-nag suite synthesizes both stacks (bundling every
    // Lambda, C5 included) in beforeAll; the 10 s default hook timeout is too
    // short on the shared CI runner.
    hookTimeout: 120000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/infrastructure/async-monitoring/**/*.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/c6-async-monitoring",
      thresholds: {
        lines: 80,
      },
    },
  },
});
