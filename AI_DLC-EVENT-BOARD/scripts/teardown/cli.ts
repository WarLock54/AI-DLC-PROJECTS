import { setTimeout as delay } from "node:timers/promises";
import { requireDeploymentEnvironment } from "../aws-environment.js";
import { createAwsPorts, createTeardownClients } from "./aws-ports.js";
import { assertTeardownRequested, redactSensitive, runTeardown } from "./teardown.js";

// Debug-sandbox cleanup only. Run with TEARDOWN=true (CI: the `teardown` job).
async function main(): Promise<void> {
  // Checked before any AWS call so a missing flag never touches the account.
  assertTeardownRequested(process.env);
  const { region } = await requireDeploymentEnvironment();
  const report = await runTeardown({
    ports: createAwsPorts(createTeardownClients(region)),
    environment: process.env,
    sleep: async (milliseconds) => {
      await delay(milliseconds);
    },
    logger: { info: (message) => console.info(message) },
  });
  console.info(
    redactSensitive(
      [
        "Teardown summary:",
        `  CloudFormation stacks deleted: ${report.stacksDeleted.join(", ") || "none"}`,
        `  Retained resources deleted: ${report.resourcesDeleted.join(", ") || "none"}`,
        `  Already absent: ${report.resourcesAlreadyAbsent.join(", ") || "none"}`,
        "  Remaining team32-ceb- stacks: none",
        "  Remaining resources tagged project=team32-ceb: none",
      ].join("\n"),
    ),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown teardown failure.";
  console.error(`Teardown failed: ${redactSensitive(message)}`);
  process.exitCode = 1;
});
