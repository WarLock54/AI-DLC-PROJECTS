// D5: runtime configuration written at deploy time as /config.json. A missing or
// invalid file is a fatal start-up error; the UI never falls back to defaults.

export interface AppConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const REGION_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+$/;
const USER_POOL_ID_PATTERN = /^[a-z]{2}(-[a-z]+)+-\d+_[0-9A-Za-z]+$/;
const CLIENT_ID_PATTERN = /^[0-9A-Za-z]+$/;

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  let response: Response;
  try {
    response = await fetchImpl("/config.json", { cache: "no-store" });
  } catch {
    throw new ConfigError("The configuration file could not be requested.");
  }
  if (!response.ok) {
    throw new ConfigError(`The configuration file returned HTTP ${response.status}.`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ConfigError("The configuration file is not valid JSON.");
  }
  return validateConfig(body);
}

export function validateConfig(body: unknown): AppConfig {
  if (typeof body !== "object" || body === null) {
    throw new ConfigError("The configuration file must contain a JSON object.");
  }
  const source = body as Record<string, unknown>;
  const region = requireMatch(source, "region", REGION_PATTERN);
  const userPoolId = requireMatch(source, "userPoolId", USER_POOL_ID_PATTERN);
  const userPoolClientId = requireMatch(source, "userPoolClientId", CLIENT_ID_PATTERN);
  return { region, userPoolId, userPoolClientId };
}

function requireMatch(source: Record<string, unknown>, field: string, pattern: RegExp): string {
  const value = source[field];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ConfigError(`The configuration field "${field}" is missing or invalid.`);
  }
  return value;
}
