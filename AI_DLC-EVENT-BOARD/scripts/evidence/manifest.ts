// C-08 evidence manifest: every approved functional and infrastructure expectation
// maps to proof that exists in the repository. Debug-sandbox proof is never wired
// to the final verification pipeline.
import { isPending } from "./placeholder.js";

export type ProofClass = "ci" | "final-sandbox" | "debug-sandbox" | "document";

export interface Proof {
  path: string;
  class: ProofClass;
  /** Pipeline job that produces this proof, when there is one. */
  pipelineJob?: string;
}

export interface Expectation {
  id: string;
  title: string;
  requirements: string;
  proofs: Proof[];
}

export interface FileSystemPort {
  exists(path: string): boolean;
  read(path: string): string;
}

export type ProofStatus = "recorded" | "pending" | "missing";

/** The twelve expectations from the team Testing Posture proof list. */
export const APPROVED_EXPECTATION_IDS = [
  "organizer-event-management",
  "resident-browse-filter",
  "shareable-event-urls",
  "rsvp-capacity-waitlist",
  "reminder-evidence",
  "admin-statistics",
  "banner-upload-limit",
  "event-archival",
  "clean-account-deployment",
  "gitlab-cicd-health-check",
  "monitoring-alerting",
  "cleanup-proof",
] as const;

/** Jobs of the final verification pipeline (the deploy path). */
export const FINAL_PIPELINE_JOBS = ["deploy", "health-check"] as const;

const C5 = "test/c5-reminders-statistics-archival";

export const EXPECTATIONS: Expectation[] = [
  {
    id: "organizer-event-management",
    title: "Organizer event management",
    requirements: "FR3",
    proofs: [
      { path: "test/c3-event-apis/unit/event-service.test.ts", class: "ci", pipelineJob: "test" },
      { path: "test/c4-ui/unit/event-management.test.ts", class: "ci" },
    ],
  },
  {
    id: "resident-browse-filter",
    title: "Resident browse and filter",
    requirements: "FR1",
    proofs: [
      { path: "test/c3-event-apis/unit/discovery-service.test.ts", class: "ci" },
      { path: "test/c4-ui/unit/events-list.test.ts", class: "ci" },
    ],
  },
  {
    id: "shareable-event-urls",
    title: "Shareable public event detail URLs",
    requirements: "FR2",
    proofs: [
      { path: "test/c3-event-apis/unit/handlers.test.ts", class: "ci" },
      { path: "test/c4-ui/unit/event-detail.test.ts", class: "ci" },
      { path: "test/c4-ui/unit/spa-rewrite.test.ts", class: "ci" },
    ],
  },
  {
    id: "rsvp-capacity-waitlist",
    title: "RSVP capacity and waitlist behavior",
    requirements: "FR5, NFR7, NFR26",
    proofs: [
      { path: "test/c3-event-apis/unit/rsvp-concurrency.test.ts", class: "ci" },
      { path: "test/c3-event-apis/unit/rsvp-service.test.ts", class: "ci" },
      { path: "docs/load-test.md", class: "debug-sandbox" },
    ],
  },
  {
    id: "reminder-evidence",
    title: "Reminder evidence",
    requirements: "FR7",
    proofs: [
      { path: `${C5}/unit/reminders.test.ts`, class: "ci" },
      { path: "docs/c5-reminders-statistics-archival.md", class: "document" },
      { path: "docs/ses-proof.md", class: "debug-sandbox" },
    ],
  },
  {
    id: "admin-statistics",
    title: "Admin statistics over deterministic seed data",
    requirements: "FR8",
    proofs: [
      { path: `${C5}/unit/statistics.test.ts`, class: "ci" },
      { path: "scripts/stats-check.ts", class: "final-sandbox", pipelineJob: "health-check" },
      { path: "docs/expected-stats.json", class: "document" },
    ],
  },
  {
    id: "banner-upload-limit",
    title: "5 MB banner upload limit",
    requirements: "FR6",
    proofs: [
      { path: "test/c3-event-apis/unit/banner-service.test.ts", class: "ci" },
      { path: "test/c4-ui/unit/banner-upload.test.ts", class: "ci" },
    ],
  },
  {
    id: "event-archival",
    title: "Event archival (backend and S3 evidence)",
    requirements: "FR9",
    proofs: [
      { path: `${C5}/unit/archival.test.ts`, class: "ci" },
      { path: "scripts/archive-invoke.ts", class: "final-sandbox", pipelineJob: "deploy" },
    ],
  },
  {
    id: "clean-account-deployment",
    title: "Clean-account IaC deployment",
    requirements: "NFR1, NFR2, NFR19",
    proofs: [
      { path: "test/c1-foundation/integration/foundation-stack.test.ts", class: "ci" },
      { path: "scripts/deploy.ts", class: "final-sandbox", pipelineJob: "deploy" },
      { path: "docs/c1-foundation.md", class: "document" },
    ],
  },
  {
    id: "gitlab-cicd-health-check",
    title: "GitLab CI/CD deployment and health check",
    requirements: "NFR1, NFR19, FR10",
    proofs: [
      { path: "test/c2-ci-cd/unit/pipeline-definition.test.ts", class: "ci" },
      { path: ".gitlab-ci.yml", class: "final-sandbox", pipelineJob: "health-check" },
      { path: "scripts/health-check.ts", class: "final-sandbox", pipelineJob: "health-check" },
    ],
  },
  {
    id: "monitoring-alerting",
    title: "Monitoring, logging, and alert evidence",
    requirements: "NFR22, NFR31",
    proofs: [
      { path: "test/c6-async-monitoring/unit/async-monitoring-stack.test.ts", class: "ci" },
      { path: "test/c6-async-monitoring/integration/cdk-nag.test.ts", class: "ci" },
      { path: "docs/load-test.md", class: "debug-sandbox" },
    ],
  },
  {
    id: "cleanup-proof",
    title: "Cleanup proof in a debug sandbox",
    requirements: "NFR30",
    proofs: [
      { path: "test/c2-ci-cd/unit/teardown.test.ts", class: "ci" },
      { path: "docs/cleanup.md", class: "debug-sandbox" },
    ],
  },
];

const PROOF_CLASSES: readonly ProofClass[] = ["ci", "final-sandbox", "debug-sandbox", "document"];

export function proofStatus(proof: Proof, fs: FileSystemPort): ProofStatus {
  if (!fs.exists(proof.path)) {
    return "missing";
  }
  return proof.class === "debug-sandbox" && isPending(fs.read(proof.path)) ? "pending" : "recorded";
}

/** Returns every problem found; an empty list means the manifest is consistent. */
export function validateManifest(
  expectations: readonly Expectation[],
  fs: FileSystemPort,
): string[] {
  const problems: string[] = [];
  const approved = new Set<string>(APPROVED_EXPECTATION_IDS);
  const seen = new Set<string>();
  for (const expectation of expectations) {
    if (seen.has(expectation.id)) {
      problems.push(`Duplicate expectation id: ${expectation.id}.`);
    }
    seen.add(expectation.id);
    if (!approved.has(expectation.id)) {
      problems.push(`Unknown expectation id: ${expectation.id}.`);
    }
    if (expectation.proofs.length === 0) {
      problems.push(`Expectation ${expectation.id} has no proof.`);
    }
    for (const proof of expectation.proofs) {
      if (!PROOF_CLASSES.includes(proof.class)) {
        problems.push(`Proof ${proof.path} has an unknown class: ${String(proof.class)}.`);
      }
      if (!fs.exists(proof.path)) {
        problems.push(`Proof file is missing for ${expectation.id}: ${proof.path}.`);
      }
      if (
        proof.class === "debug-sandbox" &&
        proof.pipelineJob !== undefined &&
        (FINAL_PIPELINE_JOBS as readonly string[]).includes(proof.pipelineJob)
      ) {
        problems.push(
          `Debug-sandbox proof ${proof.path} is wired to the final pipeline job ${proof.pipelineJob}.`,
        );
      }
    }
  }
  for (const id of APPROVED_EXPECTATION_IDS) {
    if (!seen.has(id)) {
      problems.push(`Approved expectation is missing from the manifest: ${id}.`);
    }
  }
  return problems;
}

const DEBUG_EVIDENCE_PATTERNS: ReadonlyArray<RegExp> = [
  /evidence:(load-test|cleanup|ses-proof)/,
  /evidence\/(load-test|cleanup-evidence|ses-proof)-cli/,
  /\bLOAD_TEST\b/,
  /\bDEBUG_SANDBOX\b/,
  /\bTEARDOWN_EVIDENCE\b/,
];

/** Debug-only evidence must never appear in the pipeline definition. */
export function findDebugEvidenceInPipeline(pipelineText: string): string[] {
  return pipelineText
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => !line.trim().startsWith("#"))
    .filter(({ line }) => DEBUG_EVIDENCE_PATTERNS.some((pattern) => pattern.test(line)))
    .map(
      ({ line, number }) =>
        `.gitlab-ci.yml line ${number} runs debug-only evidence: ${line.trim()}`,
    );
}

export function renderManifest(expectations: readonly Expectation[], fs: FileSystemPort): string {
  const rows = expectations.flatMap((expectation) =>
    expectation.proofs.map((proof, index) => {
      const status = proofStatus(proof, fs);
      return `| ${index === 0 ? expectation.title : ""} | ${index === 0 ? expectation.requirements : ""} | \`${proof.path}\` | ${proof.class} | ${status} |`;
    }),
  );
  return [
    "# Evidence manifest (C-08)",
    "",
    "Generated by `npm run evidence:manifest-check -- --write` from `scripts/evidence/manifest.ts`; edit the manifest, not this file.",
    "",
    "Every approved expectation maps to at least one proof that exists in the repository. Proof classes:",
    "",
    "- `ci`: runs in the validate stage of every pipeline.",
    "- `final-sandbox`: produced by the final `main` pipeline deploy path.",
    "- `debug-sandbox`: produced only by an explicit human-run debug-sandbox command; never by the final pipeline.",
    "- `document`: reviewed design or operations documentation.",
    "",
    "Status `pending` means the debug-sandbox run has not been recorded yet. The file is a placeholder, not a result.",
    "",
    "| Expectation | Requirements | Proof | Class | Status |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}
