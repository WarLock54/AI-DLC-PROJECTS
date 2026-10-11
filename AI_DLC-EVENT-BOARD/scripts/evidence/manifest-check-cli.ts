// Evidence manifest check (C-08); runs in the CI validate stage. No AWS access.
//   npm run evidence:manifest-check                      verify
//   npm run evidence:manifest-check -- --write           regenerate docs/evidence-manifest.md
//   npm run evidence:manifest-check -- --require-recorded  also fail on pending debug evidence
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { runCli } from "./guards.js";
import {
  EXPECTATIONS,
  findDebugEvidenceInPipeline,
  proofStatus,
  renderManifest,
  validateManifest,
  type FileSystemPort,
} from "./manifest.js";

const MANIFEST_PATH = "docs/evidence-manifest.md";
const PIPELINE_PATH = ".gitlab-ci.yml";

const disk: FileSystemPort = {
  exists: (path) => existsSync(path),
  read: (path) => readFileSync(path, "utf8"),
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rendered = renderManifest(EXPECTATIONS, disk);
  if (args.includes("--write")) {
    writeFileSync(MANIFEST_PATH, rendered, "utf8");
    console.info(`Wrote ${MANIFEST_PATH}.`);
  }

  const problems = [
    ...validateManifest(EXPECTATIONS, disk),
    ...findDebugEvidenceInPipeline(readFileSync(PIPELINE_PATH, "utf8")),
  ];
  if (!existsSync(MANIFEST_PATH) || readFileSync(MANIFEST_PATH, "utf8") !== rendered) {
    problems.push(
      `${MANIFEST_PATH} is out of date; run npm run evidence:manifest-check -- --write.`,
    );
  }
  if (args.includes("--require-recorded")) {
    for (const expectation of EXPECTATIONS) {
      for (const proof of expectation.proofs) {
        if (proofStatus(proof, disk) === "pending") {
          problems.push(`Debug-sandbox evidence is still pending: ${proof.path}.`);
        }
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Evidence manifest check found ${problems.length} problem(s):\n- ${problems.join("\n- ")}`,
    );
  }
  console.info("Evidence manifest is consistent.");
}

runCli("Evidence manifest check", main);
