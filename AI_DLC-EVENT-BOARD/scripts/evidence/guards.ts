// Opt-in guards shared by every evidence CLI. They run before any AWS client is
// created, so a missing opt-in never touches an account (NFR7, FR7.6, NFR30).
import { redact } from "./redact.js";

export type Environment = Record<string, string | undefined>;

export function assertOptIn(environment: Environment, name: string, purpose: string): void {
  if (environment[name] !== "true") {
    throw new Error(
      `Refusing to run: ${purpose} is debug-sandbox evidence. Set ${name}=true to run it explicitly.`,
    );
  }
}

/** Debug-only evidence must never run inside the GitLab final verification pipeline. */
export function assertNotPipeline(environment: Environment): void {
  if (environment.GITLAB_CI) {
    throw new Error(
      "Refusing to run inside a GitLab pipeline: debug-sandbox evidence is run explicitly by a person, never by the final verification pipeline.",
    );
  }
}

/** Runs a CLI main function; failures are loud, redacted, and set a non-zero exit code. */
export function runCli(name: string, main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error(`${name} failed: ${redact(message)}`);
    process.exitCode = 1;
  });
}
