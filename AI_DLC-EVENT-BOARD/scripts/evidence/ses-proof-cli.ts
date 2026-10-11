// Debug-sandbox SES proof (FR7.6):
//   DEBUG_SANDBOX=true SES_PROOF_SENDER=<verified> SES_PROOF_RECIPIENT=<verified> npm run evidence:ses-proof
import { writeFile } from "node:fs/promises";
import { createSesPorts, requireEnvironmentCredentials } from "./aws-ports.js";
import { assertNotPipeline, assertOptIn, runCli } from "./guards.js";
import { renderSesProof, runSesProof } from "./ses-proof.js";

const OUTPUT_PATH = "docs/ses-proof.md";

async function main(): Promise<void> {
  assertOptIn(process.env, "DEBUG_SANDBOX", "The real SES reminder proof");
  assertNotPipeline(process.env);
  const sender = process.env.SES_PROOF_SENDER;
  const recipient = process.env.SES_PROOF_RECIPIENT;
  if (!sender || !recipient) {
    throw new Error("SES_PROOF_SENDER and SES_PROOF_RECIPIENT must name SES-verified addresses.");
  }
  const { region } = requireEnvironmentCredentials();
  const invokeSelector = process.env.SES_PROOF_INVOKE_SELECTOR === "true";
  const record = await runSesProof(
    { environment: process.env, sender, recipient, invokeSelector },
    createSesPorts({
      region,
      selectorFunctionName: invokeSelector ? "team32-ceb-reminder-selector" : undefined,
    }),
  );
  await writeFile(OUTPUT_PATH, renderSesProof(record), "utf8");
  console.info(`Wrote ${OUTPUT_PATH}: ${record.outcome}.`);
  if (record.outcome !== "sent") {
    throw new Error("The SES proof send failed; see docs/ses-proof.md.");
  }
}

runCli("SES proof", main);
