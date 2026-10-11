const WAIVER_EXPIRES_ON = "2027-01-03";
const WAIVED_PACKAGE = "brace-expansion";
const WAIVED_VERSION = "5.0.9";
const WAIVED_NODE = "node_modules/aws-cdk-lib/node_modules/brace-expansion";
const WAIVED_ADVISORIES = new Set([1240103, 1240107, 1240111]);
const REQUIRED_HIGH_ADVISORIES = new Set([1240107, 1240111]);

interface AuditAdvisory {
  source?: number;
}

interface AuditVulnerability {
  name?: string;
  severity?: string;
  nodes?: string[];
  via?: Array<string | AuditAdvisory>;
}

interface NpmAuditReport {
  vulnerabilities?: Record<string, AuditVulnerability>;
}

export interface AuditPolicyResult {
  acceptedWaiver: boolean;
  blockers: string[];
}

export function evaluateAuditReport(
  input: unknown,
  bundledBraceExpansionVersion: string | undefined,
  today: string,
): AuditPolicyResult {
  if (
    typeof input !== "object" ||
    input === null ||
    !("vulnerabilities" in input) ||
    typeof input.vulnerabilities !== "object" ||
    input.vulnerabilities === null
  ) {
    return { acceptedWaiver: false, blockers: ["npm audit returned an invalid report"] };
  }

  const report = input as NpmAuditReport;
  const blockers: string[] = [];
  let acceptedWaiver = false;

  for (const [key, vulnerability] of Object.entries(report.vulnerabilities ?? {})) {
    if (!["high", "critical"].includes(vulnerability.severity ?? "")) {
      continue;
    }
    if (vulnerability.severity === "critical") {
      blockers.push(`${key}: Critical severity findings are never waived`);
      continue;
    }

    const sources = (vulnerability.via ?? [])
      .filter((entry): entry is AuditAdvisory => typeof entry === "object")
      .map((entry) => entry.source);
    const sourceSet = new Set(sources);
    const hasOnlyDocumentedAdvisories =
      vulnerability.via?.every(
        (entry) =>
          typeof entry === "object" &&
          typeof entry.source === "number" &&
          WAIVED_ADVISORIES.has(entry.source),
      ) === true;
    const hasRequiredAdvisories = [...REQUIRED_HIGH_ADVISORIES].every((id) => sourceSet.has(id));
    const isDocumentedWaiver =
      key === WAIVED_PACKAGE &&
      vulnerability.name === WAIVED_PACKAGE &&
      bundledBraceExpansionVersion === WAIVED_VERSION &&
      vulnerability.nodes?.length === 1 &&
      vulnerability.nodes[0] === WAIVED_NODE &&
      hasOnlyDocumentedAdvisories &&
      hasRequiredAdvisories;

    if (!isDocumentedWaiver) {
      blockers.push(`${key}: High severity finding is not covered by the documented waiver`);
      continue;
    }
    if (today >= WAIVER_EXPIRES_ON) {
      blockers.push(
        `${key}: documented waiver expired on ${WAIVER_EXPIRES_ON}; review or upgrade the dependency`,
      );
      continue;
    }
    acceptedWaiver = true;
  }

  return { acceptedWaiver, blockers };
}
