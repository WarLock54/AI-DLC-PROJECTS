import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C2 keeps its own config so C1's root vitest.config.ts stays unchanged.
// The root is pinned to the repository so include/coverage globs resolve the
// same way regardless of where the config file lives.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    environment: "node",
    include: ["test/c2-ci-cd/**/*.test.ts"],
    testTimeout: 15000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["scripts/ci/**/*.ts", "scripts/teardown/**/*.ts"],
      // Thin argument and process wiring only; their logic lives in tested modules.
      exclude: ["scripts/ci/retry-cli.ts", "scripts/teardown/cli.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/c2-ci-cd",
      thresholds: {
        lines: 80,
      },
    },
  },
});
