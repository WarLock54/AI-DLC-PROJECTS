// Structured JSON logging for the C5 operations. Like the C3 logger, callers
// pass identifiers, counts, and error names only: never emails, display names,
// tokens, claims, or message bodies.
import type { LogFields, Logger } from "../../event-api/http/logger.js";

export interface OperationsLogger extends Logger {
  info(fields: LogFields): void;
}

export function createOperationsLogger(
  write: (line: string) => void = (line) => console.log(line),
): OperationsLogger {
  return {
    info: (fields) => write(JSON.stringify({ level: "info", ...fields })),
    warn: (fields) => write(JSON.stringify({ level: "warn", ...fields })),
    error: (fields) => write(JSON.stringify({ level: "error", ...fields })),
  };
}

export { errorName } from "../../event-api/http/logger.js";
export type { LogFields };
