import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// C4 keeps its own config so the C1, C2, C3, and C6 configs stay unchanged. The
// root is pinned to the repository so include/coverage globs resolve the same
// way regardless of where the config file lives.
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  test: {
    root: repositoryRoot,
    // UI tests run in happy-dom; CDK tests under test/c4-ui/integration opt into
    // the node environment with a `// @vitest-environment node` docblock.
    environment: "happy-dom",
    include: ["test/c4-ui/**/*.test.ts"],
    // Integration tests synthesize the stack and run the UI build.
    testTimeout: 120000,
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: [
        "ui/src/**/*.ts",
        "src/infrastructure/spa-rewrite.ts",
        "src/lambda/web-deploy/**/*.ts",
        "scripts/health-check-ui.ts",
      ],
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/c4-ui",
      thresholds: {
        lines: 80,
      },
    },
  },
});
