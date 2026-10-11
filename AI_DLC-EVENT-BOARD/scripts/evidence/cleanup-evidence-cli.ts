// Debug-sandbox cleanup proof (NFR30). After the explicit TEARDOWN=true job:
//   TEARDOWN_EVIDENCE=true npm run evidence:cleanup -- --log teardown.log --exit-status 0
// Add --no-live to skip the independent post-teardown AWS inventory.
import { readFile, writeFile } from "node:fs/promises";
import { readLiveCleanupState, requireEnvironmentCredentials } from "./aws-ports.js";
import { assertNotPipeline, assertOptIn, runCli } from "./guards.js";
import { parseCleanupArguments, renderCleanup } from "./render-cleanup.js";

const OUTPUT_PATH = "docs/cleanup.md";

async function main(): Promise<void> {
  assertOptIn(process.env, "TEARDOWN_EVIDENCE", "Capturing cleanup evidence");
  assertNotPipeline(process.env);
  const args = parseCleanupArguments(process.argv.slice(2));
  const log = await readFile(args.logPath, "utf8");
  let live;
  if (args.live) {
    const { region } = requireEnvironmentCredentials();
    live = await readLiveCleanupState(region);
  }
  const verdict = renderCleanup({
    exitStatus: args.exitStatus,
    log,
    live,
    capturedAt: new Date().toISOString(),
  });
  await writeFile(OUTPUT_PATH, verdict.markdown, "utf8");
  console.info(`Wrote ${OUTPUT_PATH}: ${verdict.pass ? "PASS" : "FAIL"}.`);
  if (!verdict.pass) {
    throw new Error("Cleanup proof did not meet NFR30; see docs/cleanup.md.");
  }
}

runCli("Cleanup evidence", main);
