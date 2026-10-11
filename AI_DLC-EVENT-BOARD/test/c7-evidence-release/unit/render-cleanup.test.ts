import { describe, expect, it } from "vitest";
import { evaluateCleanup, renderCleanup } from "../../../scripts/evidence/render-cleanup.js";

const goodLog = [
  "Deleting stack team32-ceb-async-monitoring",
  "Deleting stack team32-ceb-foundation",
  "Teardown summary:",
  "  CloudFormation stacks deleted: team32-ceb-async-monitoring, team32-ceb-foundation",
  "  Retained resources deleted: none",
  "  Already absent: none",
  "  Remaining team32-ceb- stacks: none",
  "  Remaining resources tagged project=team32-ceb: none",
].join("\n");

const base = { exitStatus: 0, log: goodLog, capturedAt: "2026-10-05T12:00:00.000Z" };

describe("renderCleanup (NFR30)", () => {
  it("passes only when exit 0, no stacks, and no tagged resources remain", () => {
    const verdict = renderCleanup(base);
    expect(verdict.pass).toBe(true);
    expect(verdict.markdown).toContain("**Verdict: PASS**");
    expect(verdict.markdown).toContain("Remaining team32-ceb- stacks: none");
    expect(verdict.markdown).toContain("final verification deployment is left running");
  });

  it("rejects a non-zero exit status", () => {
    const verdict = renderCleanup({ ...base, exitStatus: 1 });
    expect(verdict.pass).toBe(false);
    expect(verdict.markdown).toContain("**Verdict: FAIL**");
  });

  it("rejects remaining stacks", () => {
    const log = goodLog.replace(
      "Remaining team32-ceb- stacks: none",
      "Remaining team32-ceb- stacks: team32-ceb-foundation",
    );
    const verdict = renderCleanup({ ...base, log });
    expect(verdict.pass).toBe(false);
    expect(verdict.criteria.filter((c) => !c.pass).map((c) => c.label)).toEqual([
      "No team32-ceb- CloudFormation stacks remain",
    ]);
  });

  it("rejects remaining tagged resources", () => {
    const log = goodLog.replace(
      "tagged project=team32-ceb: none",
      "tagged project=team32-ceb: 2 resources",
    );
    expect(renderCleanup({ ...base, log }).pass).toBe(false);
  });

  it("rejects truncated or unrelated input", () => {
    expect(renderCleanup({ ...base, log: "Deleting stack team32-ceb-foundation" }).pass).toBe(
      false,
    );
    expect(renderCleanup({ ...base, log: "" }).pass).toBe(false);
  });

  it("includes independent live checks and fails when they find resources", () => {
    const ok = evaluateCleanup({ ...base, live: { remainingStacks: [], taggedResourceCount: 0 } });
    expect(ok.every((c) => c.pass)).toBe(true);
    expect(ok).toHaveLength(6);
    const bad = renderCleanup({
      ...base,
      live: { remainingStacks: ["team32-ceb-foundation"], taggedResourceCount: 1 },
    });
    expect(bad.pass).toBe(false);
  });

  it("redacts the teardown output and keeps only the last 200 lines", () => {
    const account = ["1234", "5678", "9012"].join("");
    const noisy = Array.from({ length: 250 }, (_, i) => `line ${i} ${account}`).join("\n");
    const verdict = renderCleanup({ ...base, log: `${noisy}\n${goodLog}` });
    expect(verdict.markdown).not.toContain(account);
    expect(verdict.markdown).toContain("lines omitted");
    expect(verdict.markdown).not.toContain("line 0 ");
  });
});
