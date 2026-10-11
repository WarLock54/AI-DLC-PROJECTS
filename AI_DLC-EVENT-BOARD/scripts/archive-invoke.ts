// C5 post-deploy archival step (C-06 postDeploy, FR9.3, FR9.6). Runs in the
// deploy job after `npm run seed`; exits non-zero on any failure or mismatch.
import { runArchiveInvoke } from "./c5/archive-evidence.js";
import { createArchiveInvokePorts } from "./c5/aws-ports.js";
import { readFoundationOutputs } from "./c5/outputs.js";

async function main(): Promise<void> {
  const outputs = await readFoundationOutputs([
    "ArchiveFunctionName",
    "ArchiveBucketName",
    "SiteUrl",
  ] as const);
  await runArchiveInvoke(outputs, createArchiveInvokePorts());
  console.info("Post-deploy archival and archive evidence checks succeeded.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown archival failure.";
  console.error(`Archive invocation failed: ${message}`);
  process.exitCode = 1;
});
