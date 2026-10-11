import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function runCdk(args: string[], environment: NodeJS.ProcessEnv = process.env): void {
  const executable = resolve("node_modules", "aws-cdk", "bin", "cdk");
  execFileSync(process.execPath, [executable, ...args], {
    stdio: "inherit",
    env: environment,
  });
}
