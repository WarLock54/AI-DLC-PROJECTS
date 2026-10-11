import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { parseRetryArguments, retryCommand } from "./retry.js";

// Usage: tsx scripts/ci/retry-cli.ts --attempts 10 --delay-seconds 30 -- npm run health-check
async function main(): Promise<void> {
  const options = parseRetryArguments(process.argv.slice(2));
  await retryCommand({
    command: options.command,
    args: options.args,
    attempts: options.attempts,
    delayMs: options.delaySeconds * 1000,
    run: (command, args) => {
      execFileSync(command, args, { stdio: "inherit" });
    },
    sleep: async (milliseconds) => {
      await delay(milliseconds);
    },
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown retry failure.";
  console.error(`Retry failed: ${message}`);
  process.exitCode = 1;
});
