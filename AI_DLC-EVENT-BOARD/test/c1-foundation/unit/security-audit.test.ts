import { describe, expect, it } from "vitest";
import { evaluateAuditReport } from "../../../scripts/security-audit-policy.js";

const approvedFinding = {
  vulnerabilities: {
    "brace-expansion": {
      name: "brace-expansion",
      severity: "high",
      nodes: ["node_modules/aws-cdk-lib/node_modules/brace-expansion"],
      via: [{ source: 1240103 }, { source: 1240107 }, { source: 1240111 }],
    },
  },
};

describe("dependency audit waiver policy", () => {
  it("accepts only the documented bundled finding before its review date", () => {
    expect(evaluateAuditReport(approvedFinding, "5.0.9", "2026-10-03")).toEqual({
      acceptedWaiver: true,
      blockers: [],
    });
  });

  it("blocks a different high-severity package", () => {
    const report = {
      vulnerabilities: {
        other: { name: "other", severity: "high", nodes: [], via: [] },
      },
    };
    expect(evaluateAuditReport(report, "5.0.9", "2026-10-03").blockers).toHaveLength(1);
  });

  it("blocks an unexpected path or bundled version", () => {
    expect(evaluateAuditReport(approvedFinding, "5.0.10", "2026-10-03").blockers).toHaveLength(1);
  });

  it("blocks the waiver on or after its review date", () => {
    expect(evaluateAuditReport(approvedFinding, "5.0.9", "2027-01-03").blockers).toHaveLength(1);
  });

  it("never waives Critical findings", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": {
          ...approvedFinding.vulnerabilities["brace-expansion"],
          severity: "critical",
        },
      },
    };
    expect(evaluateAuditReport(report, "5.0.9", "2026-10-03").blockers).toHaveLength(1);
  });
});
