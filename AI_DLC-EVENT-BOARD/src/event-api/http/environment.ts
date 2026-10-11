export type Environment = Record<string, string | undefined>;

/** Reads a required setting, failing fast with a clear message when absent. */
export function requireEnv(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}
