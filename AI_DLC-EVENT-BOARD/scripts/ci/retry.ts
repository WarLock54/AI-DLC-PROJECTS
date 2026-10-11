/**
 * Bounded retry for a CI command such as the post-deploy health check.
 *
 * The runner throws on a non-zero exit. Only attempt counters are logged; the
 * command's own output goes to the job log through the runner, and nothing
 * here reads or prints the environment.
 */
export type CommandRunner = (command: string, args: readonly string[]) => void;
export type Sleep = (milliseconds: number) => Promise<void>;

export interface RetryOptions {
  command: string;
  args: readonly string[];
  attempts: number;
  delayMs: number;
  run: CommandRunner;
  sleep: Sleep;
  log?: (message: string) => void;
}

export interface RetryArguments {
  attempts: number;
  delaySeconds: number;
  command: string;
  args: string[];
}

export class RetryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    options: { cause: unknown },
  ) {
    super(`Command failed after ${attempts} attempt(s).`, options);
    this.name = "RetryExhaustedError";
  }
}

function assertRetryBounds(attempts: number, delayMs: number): void {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError("attempts must be an integer of at least 1.");
  }
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("delay must be a finite number of at least 0.");
  }
}

/** Runs the command until it succeeds; returns the 1-based attempt that succeeded. */
export async function retryCommand(options: RetryOptions): Promise<number> {
  const { command, args, attempts, delayMs, run, sleep } = options;
  const log = options.log ?? ((message: string) => console.info(message));
  assertRetryBounds(attempts, delayMs);
  if (command.trim() === "") {
    throw new RangeError("command must not be empty.");
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    log(`Attempt ${attempt}/${attempts}.`);
    try {
      run(command, args);
      log(`Attempt ${attempt}/${attempts} succeeded.`);
      return attempt;
    } catch (error: unknown) {
      lastError = error;
      log(`Attempt ${attempt}/${attempts} failed.`);
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw new RetryExhaustedError(attempts, { cause: lastError });
}

function parseNumericFlag(flag: string, value: string | undefined): number {
  if (value === undefined || value.trim() === "" || !Number.isFinite(Number(value))) {
    throw new RangeError(`${flag} requires a numeric value.`);
  }
  return Number(value);
}

/** Parses `--attempts N --delay-seconds S -- <command> [args...]`. */
export function parseRetryArguments(argv: readonly string[]): RetryArguments {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    throw new RangeError("Missing `--` separator before the command to retry.");
  }
  const [command, ...args] = argv.slice(separator + 1);
  if (!command) {
    throw new RangeError("No command was given after `--`.");
  }

  let attempts: number | undefined;
  let delaySeconds: number | undefined;
  const flags = argv.slice(0, separator);
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (flag === "--attempts") {
      attempts = parseNumericFlag(flag, value);
    } else if (flag === "--delay-seconds") {
      delaySeconds = parseNumericFlag(flag, value);
    } else {
      throw new RangeError(`Unknown option '${flag}'.`);
    }
  }
  if (attempts === undefined || delaySeconds === undefined) {
    throw new RangeError("Both --attempts and --delay-seconds are required.");
  }
  assertRetryBounds(attempts, delaySeconds * 1000);
  return { attempts, delaySeconds, command, args };
}
