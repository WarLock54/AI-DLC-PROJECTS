// Generates docs/cost-notes.md from the deterministic cost model (NFR9). No AWS access.
import { writeFile } from "node:fs/promises";
import { EXPECTED_TRAFFIC, estimateMonthlyCost, renderCostNotes } from "./cost-model.js";
import { runCli } from "./guards.js";

async function main(): Promise<void> {
  const estimate = estimateMonthlyCost(EXPECTED_TRAFFIC);
  await writeFile("docs/cost-notes.md", renderCostNotes(estimate), "utf8");
  console.info(`Wrote docs/cost-notes.md: $${estimate.totalUsd.toFixed(2)} per month.`);
  if (!estimate.withinTarget) {
    throw new Error(`The estimate exceeds the $${estimate.targetUsd} monthly target.`);
  }
}

runCli("Cost notes", main);
