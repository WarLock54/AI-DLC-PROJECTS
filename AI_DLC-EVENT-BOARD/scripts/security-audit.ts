import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { evaluateAuditReport } from "./security-audit-policy.js";

interface PackageLock {
  packages?: Record<string, { version?: string }>;
}

async function main(): Promise<void> {
  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath) {
    throw new Error("Run this gate with `npm run security-audit` so npm can be located safely.");
  }

  const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as PackageLock;
  const bundledVersion =
    lock.packages?.["node_modules/aws-cdk-lib/node_modules/brace-expansion"]?.version;
  let output = "";
  try {
    output = execFileSync(process.execPath, [npmExecPath, "audit", "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("stdout" in error) ||
      typeof error.stdout !== "string"
    ) {
      throw new Error("npm audit failed before returning a parseable JSON report", {
        cause: error,
      });
    }
    output = error.stdout;
  }

  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch (error: unknown) {
    throw new Error("npm audit returned invalid JSON", { cause: error });
  }

  const result = evaluateAuditReport(report, bundledVersion, new Date().toISOString().slice(0, 10));
  if (result.blockers.length > 0) {
    throw new Error(`Dependency security audit failed:\n${result.blockers.join("\n")}`);
  }
  if (result.acceptedWaiver) {
    console.warn(
      "Accepted the documented Onur-owned brace-expansion@5.0.9 waiver; " +
        "review/expiry date: 2027-01-03.",
    );
  } else {
    console.info("Dependency security audit passed with no unwaived High/Critical findings.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Dependency security audit failed");
  process.exitCode = 1;
});
