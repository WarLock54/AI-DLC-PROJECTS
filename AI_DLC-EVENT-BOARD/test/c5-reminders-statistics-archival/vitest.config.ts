import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C5 keeps its own config so the C1, C2, C3, C4, and C6 configs stay unchanged.
// The root is pinned to the repository so include/coverage globs resolve the
// same way regardless of where the config file lives.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    environment: "node",
    include: ["test/c5-reminders-statistics-archival/**/*.test.ts"],
    // CDK synthesis bundles the C3 and C5 Lambda functions; allow for slower CI runners.
    testTimeout: 120000,
    // The integration suite synthesizes the app in beforeAll; the 10 s default
    // hook timeout is too short on the shared CI runner.
    hookTimeout: 120000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      // C5 backend business logic (reminder selection and delivery, statistics,
      // archival) plus the thin C5 Lambda entry points. NFR25: 80% lines.
      include: [
        "src/operations/**/*.ts",
        "src/lambda/reminder-selector/**/*.ts",
        "src/lambda/reminder-worker/**/*.ts",
        "src/lambda/admin-stats/**/*.ts",
        "src/lambda/archival/**/*.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/c5-reminders-statistics-archival",
      thresholds: {
        lines: 80,
      },
    },
  },
});
