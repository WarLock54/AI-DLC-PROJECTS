// Structured JSON logging. Callers pass identifiers and error names only: never
// emails, display names, tokens, claims, or request bodies.
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  error(fields: LogFields): void;
  warn(fields: LogFields): void;
}

export function createJsonLogger(
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  return {
    error: (fields) => write(JSON.stringify({ level: "error", ...fields })),
    warn: (fields) => write(JSON.stringify({ level: "warn", ...fields })),
  };
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
