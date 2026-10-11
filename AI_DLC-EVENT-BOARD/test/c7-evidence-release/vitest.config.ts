import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C7 keeps its own config so C1's root vitest.config.ts stays unchanged.
// The AWS adapters and CLI entry points are exercised only in the debug sandbox;
// their opt-in guards have their own unit tests.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    environment: "node",
    include: ["test/c7-evidence-release/**/*.test.ts"],
    testTimeout: 30000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["scripts/evidence/**/*.ts"],
      exclude: ["scripts/evidence/aws-ports.ts", "scripts/evidence/*-cli.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/c7-evidence-release",
      thresholds: {
        lines: 80,
      },
    },
  },
});
