import { afterAll, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { buildTeamConstructionBoard, deriveTeamUnitProgressModel } from "../aidlc-orchestrate.ts";
import { eventMatchesClaimAttempt, latestMainWorkflowStageRunFloorForProject, readAuditShardEvents, readStateFile, unitLifecycleSnapshot, withTeamProgressRead } from "../aidlc-lib.ts";
import { completedIntegrationUnits } from "../aidlc-unit.ts";
import { isPlanApprovalPrerequisite } from "../../hooks/aidlc-plan-approval-guard.ts";
import { projectTeamUnitProgressSection } from "../aidlc-state.ts";

const root = resolve(import.meta.dir, "../../..");
const fixture = mkdtempSync(join(tmpdir(), "aidlc-team-progress-"));
cpSync(join(root, "aidlc"), join(fixture, "aidlc"), {
  recursive: true,
  filter: (path) => !path.includes(".aidlc-engine") && !path.endsWith("runtime-graph.json") && !path.endsWith(".aidlc-claim-registry.json"),
});
symlinkSync(join(root, ".claude"), join(fixture, ".claude"));
// Freeze C7 as pending in this recovery scenario even after the real workflow
// approves it. Keep the actual C1-C6 history that originally exposed the bug.
const fixtureAudit = join(fixture, "aidlc/spaces/default/intents/261001-community-event-board/audit");
for (const name of readdirSync(fixtureAudit).filter(name => name.endsWith(".md"))) {
  const path = join(fixtureAudit, name);
  writeFileSync(path, readFileSync(path, "utf8").split(/\n---\n/).filter(block => !/^\*\*Unit\*\*: c7-evidence-release\s*$/m.test(block)).join("\n---\n"));
}
const unit = "c5-reminders-statistics-archival";
const intent = "01a0f4f8-20ba-7e0e-acdc-d5adf66d840d";
writeFileSync(join(fixture, "aidlc/.aidlc-unit-scope.json"), JSON.stringify({
  version: 1, space: "default", intent_uuid: intent, intent_id8: "f66d840d",
  unit, owner: "test", generation: 1, nonce: "test", claim_ref: "test",
  claim_oid: "test", claimed_from_oid: "test", integration_ref: "test",
  gate_rhythm: "per-stage",
}));
writeFileSync(join(fixture, "aidlc/.aidlc-claim-generations.json"), JSON.stringify({
  [`default/${intent}/${unit}`]: 1,
  [`default/${intent}/c4-ui`]: 1,
  [`default/${intent}/c6-async-monitoring-infrastructure`]: 1,
}));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

test("approval projection replaces stale question marks without moving the stage", () => {
  const state = readStateFile(fixture);
  const stale = state.replace(/^\| c5-reminders-statistics-archival \|.*$/m, `| ${unit} | test | [?] | [?] |`);
  const updated = projectTeamUnitProgressSection(fixture, stale);
  expect(updated.split("\n").find(line => line.startsWith(`| ${unit} |`))).toMatch(/\| \[x\] \| \[x\] \|$/);
  const omitTable = (text: string) => text.replace(/## Unit Progress\n[\s\S]*?(?=## Current Status)/, "");
  expect(omitTable(updated)).toBe(omitTable(stale));
  expect(projectTeamUnitProgressSection(fixture, updated)).toBe(updated);
  expect(readStateFile(fixture)).toBe(state);
});

test("unsorted audit shards retain the active unit after a gate rejection", () => {
  const row = (event: string, timestamp: string, shardIndex: number, pos: number, extra = "") => ({
    event, timestamp, shardIndex, pos, shard: `shard-${shardIndex}.md`,
    block: `**Event**: ${event}\n**Timestamp**: ${timestamp}\n**Stage**: code-generation\n**Unit**: ${unit}\n**Attempt Generation**: 1\n${extra}`,
  });
  const old = row("WORKFLOW_STARTED", "2026-10-01T00:00:00Z", 1, 0);
  const rejected = row("GATE_REJECTED", "2026-10-06T14:19:55Z", 0, 0);
  const floor = "GATE_REJECTED:2026-10-06T14:19:55Z#1";
  const started = row("UNIT_STARTED", "2026-10-06T14:25:04Z", 0, 1, `**Run floor**: ${floor}\n`);
  const rows = [rejected, started, old];
  expect(latestMainWorkflowStageRunFloorForProject(fixture, "code-generation", true, unit, rows)).toBe(floor);
  expect(unitLifecycleSnapshot(fixture, "code-generation", rows, readStateFile(fixture)).checkpoint?.unit).toBe(unit);
  const completed = row("UNIT_COMPLETED", "2026-10-06T14:26:04Z", 0, 2, `**Run floor**: ${floor}\n`);
  const snapshot = unitLifecycleSnapshot(fixture, "code-generation", [rejected, started, completed, old], readStateFile(fixture));
  expect(snapshot.checkpoint).toBeNull();
  expect(snapshot.receipts.has(unit)).toBe(true);
  const stale = { ...completed, block: completed.block.replace(floor, "WORKFLOW_STARTED:2026-10-01T00:00:00Z#1") };
  expect(unitLifecycleSnapshot(fixture, "code-generation", [rejected, stale, old], readStateFile(fixture)).receipts.has(unit)).toBe(false);
  const tied = row("GATE_REJECTED", rejected.timestamp, 2, 0);
  const ambiguous = latestMainWorkflowStageRunFloorForProject(fixture, "code-generation", true, unit, [tied, old, rejected]);
  expect(ambiguous).toStartWith("AMBIGUOUS:");
  expect(latestMainWorkflowStageRunFloorForProject(fixture, "code-generation", true, unit, [rejected, old, tied])).toBe(ambiguous);
});

test("integration eligibility uses completion and approval evidence, not saved checkboxes", () => {
  const state = readStateFile(fixture);
  const rows = readAuditShardEvents(fixture).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.shardIndex - b.shardIndex || a.pos - b.pos);
  const units = ["c1-foundation", "c2-ci-cd", "c3-event-apis", "c4-ui", unit, "c6-async-monitoring-infrastructure", "c7-evidence-release"].map((name, index) => ({ name, kind: ["packaging", "packaging", "service", "ui", "service", "packaging", "packaging"][index] }));
  const complete = completedIntegrationUnits(fixture, state.replace(/\[x\]/g, "[ ]"), units, rows);
  expect([...complete].sort()).toEqual(units.slice(0, 6).map(u => u.name).sort());
  for (const missingEvent of ["UNIT_COMPLETED", "GATE_APPROVED"]) {
    const missingEvidence = rows.filter(row => !(row.event === missingEvent && row.block.includes(`**Unit**: ${unit}\n`)));
    expect(missingEvidence.length).toBeLessThan(rows.length);
    const checkedState = state.replace(/\[ \]/g, "[x]");
    expect(completedIntegrationUnits(fixture, checkedState, units, missingEvidence).has(unit)).toBe(false);
  }
});

test("plan approval permits diagnostics but keeps generation and mutations guarded", () => {
  for (const args of [["--status"], ["engine", "status"], ["doctor"], ["--doctor"], ["doctor", "--verbose"]]) {
    expect(isPlanApprovalPrerequisite(args)).toBe(true);
  }
  for (const args of [["engine", "status", "&&", "touch", "probe"], ["doctor", "--export"], ["engine", "orchestrate", "report", "--result", "approved"], ["engine", "state", "set", "Status", "Completed"]]) {
    expect(isPlanApprovalPrerequisite(args)).toBe(false);
  }
});

test("C5-scoped projection retains all six approved Units, leaves C7 unfinished", () => {
  const state = readStateFile(fixture);
  const model = deriveTeamUnitProgressModel(fixture, state, undefined, undefined, { readOnly: true });
  for (const name of ["c1-foundation", "c2-ci-cd", "c3-event-apis", "c4-ui", unit, "c6-async-monitoring-infrastructure"]) {
    expect(model.section.split("\n").find((line) => line.startsWith(`| ${name} |`))).toMatch(/\| \[x\] \| \[x\] \|$/);
  }
  expect(model.section.split("\n").find((line) => line.startsWith("| c7-evidence-release |"))).toMatch(/\| \[[ ?R-]\] \| \[[ ?R-]\] \|$/);
  expect(deriveTeamUnitProgressModel(fixture, state, undefined, undefined, { readOnly: true }).section).toBe(model.section);
  expect(readStateFile(fixture)).toBe(state);
});

test("stale saved table cannot contradict the board's computed dependencies", () => {
  const state = readStateFile(fixture).replace(/\[x\]/g, "[ ]");
  const board = buildTeamConstructionBoard(fixture, state, { readOnly: true });
  expect(board.claimable).toContain("c7-evidence-release");
  expect(board.blocked).toEqual([]);
});

test("projection does not weaken normal scoped access or accept stale generations", () => {
  const foreign = "**Unit**: c4-ui\n**Attempt Generation**: 1\n";
  expect(eventMatchesClaimAttempt(fixture, foreign, "c4-ui")).toBe(false);
  expect(withTeamProgressRead(() => eventMatchesClaimAttempt(fixture, foreign, "c4-ui"))).toBe(true);
  const stale = foreign.replace("Generation**: 1", "Generation**: 0");
  expect(withTeamProgressRead(() => eventMatchesClaimAttempt(fixture, stale, "c4-ui"))).toBe(false);
  const staleOwn = `**Unit**: ${unit}\n**Attempt Generation**: 0\n`;
  expect(withTeamProgressRead(() => eventMatchesClaimAttempt(fixture, staleOwn, unit))).toBe(false);
  expect(withTeamProgressRead(() => eventMatchesClaimAttempt(fixture, `**Unit**: ${unit}\n`, unit))).toBe(false);
  expect(() => withTeamProgressRead(() => { throw new Error("test"); })).toThrow("test");
  expect(eventMatchesClaimAttempt(fixture, foreign, "c4-ui")).toBe(false);
});
