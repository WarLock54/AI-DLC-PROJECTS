import { readFile } from "node:fs/promises";

export const FOUNDATION_STACK = process.env.C1_STACK_NAME ?? "team32-ceb-foundation";
export const OUTPUTS_PATH = process.env.CDK_OUTPUTS_FILE ?? "cdk-outputs.json";

/**
 * Reads the named C-01 outputs of the foundation stack from the deploy job's
 * cdk-outputs.json artifact. Throws when any of them is missing or empty.
 */
export async function readFoundationOutputs<K extends string>(
  names: readonly K[],
  read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
): Promise<Record<K, string>> {
  const file = JSON.parse(await read(OUTPUTS_PATH)) as Record<
    string,
    Record<string, string> | undefined
  >;
  const stack = file[FOUNDATION_STACK];
  const missing = names.filter((name) => !stack?.[name]);
  if (!stack || missing.length > 0) {
    throw new Error(`C-01 outputs are missing from ${OUTPUTS_PATH}: ${missing.join(", ")}.`);
  }
  return Object.fromEntries(names.map((name) => [name, stack[name]])) as Record<K, string>;
}

/** The deployed HTTPS CloudFront URL; plain HTTP is rejected. */
export function requireHttpsSiteUrl(siteUrl: string): URL {
  const url = new URL(siteUrl);
  if (url.protocol !== "https:") {
    throw new Error("Post-deploy checks must use the deployed HTTPS CloudFront URL.");
  }
  return url;
}
