import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { findProhibited, isCandidate } from "./prohibited-token-policy.js";

const ROOT = process.cwd();

function getTrackedFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\0").filter(Boolean);
}

async function scanFile(path: string): Promise<string[]> {
  // `git ls-files` includes tracked paths removed in the working tree; these
  // will disappear from the scan after the deletion is committed.
  if (!existsSync(join(ROOT, path))) {
    return [];
  }
  const contents = await readFile(join(ROOT, path), "utf8");
  return findProhibited(contents).map((line) => `${path}:${line}`);
}

async function scanTrackedProjectFiles(): Promise<string[]> {
  const findings: string[] = [];
  const candidates = getTrackedFiles().filter(isCandidate);
  for (const path of candidates) {
    findings.push(...(await scanFile(path)));
  }
  return findings;
}

scanTrackedProjectFiles()
  .then((findings) => {
    if (findings.length > 0) {
      console.error(`Prohibited token found:\n${findings.join("\n")}`);
      process.exitCode = 1;
      return;
    }
    console.info("Prohibited-token check passed.");
  })
  .catch((error: unknown) => {
    console.error(
      `Prohibited-token check failed: ${error instanceof Error ? error.message : "scan error"}`,
    );
    process.exitCode = 1;
  });
