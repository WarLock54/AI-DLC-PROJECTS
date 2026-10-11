import { readFile } from "node:fs/promises";
import { checkUi } from "./health-check-ui.js";

const STACK_NAME = process.env.C1_STACK_NAME ?? "team32-ceb-foundation";
const OUTPUTS_PATH = process.env.CDK_OUTPUTS_FILE ?? "cdk-outputs.json";

async function healthCheck(): Promise<void> {
  const outputFile = JSON.parse(await readFile(OUTPUTS_PATH, "utf8")) as Record<
    string,
    Record<string, string>
  >;
  const stack = outputFile[STACK_NAME];
  const siteUrl = stack?.SiteUrl;
  const apiBaseUrl = stack?.ApiBaseUrl;
  if (!siteUrl || siteUrl !== apiBaseUrl) {
    throw new Error("C-01 SiteUrl and ApiBaseUrl outputs are missing or inconsistent.");
  }
  const endpoint = new URL("/api/health", siteUrl);
  if (endpoint.protocol !== "https:") {
    throw new Error("Health checks must use the deployed HTTPS CloudFront URL.");
  }

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Health endpoint returned HTTP ${response.status}.`);
  }
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("status" in body) || body.status !== "ok") {
    throw new Error('Health endpoint did not return the approved {"status":"ok"} response.');
  }
  console.info("HTTPS CloudFront health check succeeded.");
  // C4 (D17): the web UI must also be served.
  await checkUi(siteUrl);
  console.info("Web UI health check succeeded.");
}

healthCheck().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown health-check failure.";
  console.error(`Health check failed: ${message}`);
  process.exitCode = 1;
});
