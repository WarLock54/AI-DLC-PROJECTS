import { runCdk } from "./cdk-cli.js";
import { resolveRegion } from "../src/config/region.js";

try {
  resolveRegion();
  runCdk(["synth"]);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown synthesis failure.";
  console.error(`Synthesis failed: ${message}`);
  process.exitCode = 1;
}
