import { describe, expect, it } from "vitest";
import {
  APPROVED_EXPECTATION_IDS,
  EXPECTATIONS,
  findDebugEvidenceInPipeline,
  proofStatus,
  renderManifest,
  validateManifest,
  type Expectation,
  type FileSystemPort,
} from "../../../scripts/evidence/manifest.js";
import { PENDING_MARKER } from "../../../scripts/evidence/placeholder.js";

function memoryFs(files: Record<string, string> = {}, defaultExists = true): FileSystemPort {
  return {
    exists: (path) => path in files || defaultExists,
    read: (path) => files[path] ?? "recorded content",
  };
}

const clone = (): Expectation[] => structuredClone(EXPECTATIONS);

describe("evidence manifest (C-08)", () => {
  it("contains all twelve approved expectations exactly once", () => {
    expect(APPROVED_EXPECTATION_IDS).toHaveLength(12);
    expect(EXPECTATIONS.map((e) => e.id).sort()).toEqual([...APPROVED_EXPECTATION_IDS].sort());
    expect(validateManifest(EXPECTATIONS, memoryFs())).toEqual([]);
  });

  it("references only proof files that exist in the repository", async () => {
    const { existsSync } = await import("node:fs");
    const missing = EXPECTATIONS.flatMap((e) => e.proofs)
      .filter((proof) => !existsSync(proof.path))
      .map((proof) => proof.path);
    expect(missing).toEqual([]);
  });

  it("reports a missing proof file", () => {
    const fs: FileSystemPort = { exists: (p) => p !== "docs/cleanup.md", read: () => "" };
    expect(validateManifest(EXPECTATIONS, fs)).toEqual([
      "Proof file is missing for cleanup-proof: docs/cleanup.md.",
    ]);
  });

  it("rejects a debug-sandbox proof wired to the final pipeline", () => {
    const entries = clone();
    const proof = entries[3].proofs.find((p) => p.class === "debug-sandbox");
    if (!proof) throw new Error("fixture");
    proof.pipelineJob = "health-check";
    const problems = validateManifest(entries, memoryFs());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/wired to the final pipeline job health-check/);
  });

  it("rejects duplicate, unknown, and missing expectation ids", () => {
    const entries = clone();
    entries.push({ ...entries[0] });
    entries.push({ id: "made-up", title: "x", requirements: "x", proofs: entries[0].proofs });
    entries.splice(1, 1);
    const problems = validateManifest(entries, memoryFs());
    expect(problems).toContain("Duplicate expectation id: organizer-event-management.");
    expect(problems).toContain("Unknown expectation id: made-up.");
    expect(problems).toContain(
      "Approved expectation is missing from the manifest: resident-browse-filter.",
    );
  });

  it("rejects an expectation without proof and a proof with an unknown class", () => {
    const entries = clone();
    entries[0].proofs = [];
    (entries[1].proofs[0] as { class: string }).class = "magic";
    const problems = validateManifest(entries, memoryFs());
    expect(problems).toContain("Expectation organizer-event-management has no proof.");
    expect(problems.some((p) => p.includes("unknown class: magic"))).toBe(true);
  });

  it("marks debug-sandbox placeholders as pending and recorded runs as recorded", () => {
    const proof = { path: "docs/load-test.md", class: "debug-sandbox" as const };
    expect(proofStatus(proof, memoryFs({ "docs/load-test.md": `x ${PENDING_MARKER}` }))).toBe(
      "pending",
    );
    expect(proofStatus(proof, memoryFs({ "docs/load-test.md": "Verdict: PASS" }))).toBe("recorded");
    expect(proofStatus(proof, { exists: () => false, read: () => "" })).toBe("missing");
    expect(proofStatus({ path: "a", class: "ci" }, memoryFs({ a: PENDING_MARKER }))).toBe(
      "recorded",
    );
  });

  it("renders a table with one row per proof", () => {
    const markdown = renderManifest(EXPECTATIONS, memoryFs());
    const rows = markdown.split("\n").filter((line) => line.startsWith("| ") && line.includes("`"));
    expect(rows).toHaveLength(EXPECTATIONS.reduce((sum, e) => sum + e.proofs.length, 0));
    expect(markdown).toContain("Cleanup proof in a debug sandbox");
  });

  it("finds debug-only evidence commands in a pipeline definition but ignores comments", () => {
    const clean = [
      "# npm run evidence:load-test is debug only",
      "script:",
      "  - npm run evidence:manifest-check",
    ];
    expect(findDebugEvidenceInPipeline(clean.join("\n"))).toEqual([]);
    const dirty = ["script:", "  - npm run evidence:load-test", "  - DEBUG_SANDBOX=true npm run x"];
    expect(findDebugEvidenceInPipeline(dirty.join("\n"))).toHaveLength(2);
  });
});
