// C4 (D17): proves the deployed UI is served. A deep link must return the HTML
// shell (which exercises the CloudFront rewrite), and /config.json must carry
// the Cognito identifiers the UI needs. Any failure throws a clear message.

const TIMEOUT_MS = 15_000;

export async function checkUi(siteUrl: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await checkDeepLink(new URL("/events", siteUrl), fetchImpl);
  await checkConfig(new URL("/config.json", siteUrl), fetchImpl);
}

async function checkDeepLink(url: URL, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (response.status !== 200) {
    throw new Error(`UI deep link /events returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/html")) {
    throw new Error(`UI deep link /events returned "${contentType}" instead of text/html.`);
  }
}

async function checkConfig(url: URL, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (response.status !== 200) {
    throw new Error(`UI config.json returned HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("UI config.json is not valid JSON.");
  }
  const config = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  for (const field of ["userPoolId", "userPoolClientId"]) {
    const value = config[field];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`UI config.json has no ${field}.`);
    }
  }
}
