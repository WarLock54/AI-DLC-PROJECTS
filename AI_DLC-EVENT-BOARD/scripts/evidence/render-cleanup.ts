// Renders docs/cleanup.md (NFR30) from the saved output of the explicit
// TEARDOWN=true job. The verdict is derived from the evidence; failing or
// truncated input can never produce a passing document.
import { redact } from "./redact.js";

export interface CleanupInput {
  /** Exit status of the TEARDOWN=true job. */
  exitStatus: number;
  /** Saved teardown output. */
  log: string;
  /** Optional independent live checks made after the job. */
  live?: { remainingStacks: readonly string[]; taggedResourceCount: number };
  capturedAt: string;
}

export interface CleanupCriterion {
  label: string;
  pass: boolean;
  detail: string;
}

export interface CleanupVerdict {
  pass: boolean;
  criteria: CleanupCriterion[];
  markdown: string;
}

const STACKS_LINE = /^\s*Remaining team32-ceb- stacks:\s*(.+?)\s*$/m;
const TAGGED_LINE = /^\s*Remaining resources tagged project=team32-ceb:\s*(.+?)\s*$/m;
const MAX_LOG_LINES = 200;

export function evaluateCleanup(input: CleanupInput): CleanupCriterion[] {
  const hasSummary = input.log.includes("Teardown summary:");
  const stacks = STACKS_LINE.exec(input.log)?.[1];
  const tagged = TAGGED_LINE.exec(input.log)?.[1];
  const criteria: CleanupCriterion[] = [
    {
      label: "TEARDOWN=true job exited 0",
      pass: input.exitStatus === 0,
      detail: `exit status ${input.exitStatus}`,
    },
    {
      label: "Teardown output is complete",
      pass: hasSummary && stacks !== undefined && tagged !== undefined,
      detail: hasSummary ? "summary present" : "summary missing (truncated or wrong input)",
    },
    {
      label: "No team32-ceb- CloudFormation stacks remain",
      pass: stacks === "none",
      detail: stacks === undefined ? "not reported" : stacks,
    },
    {
      label: "Tag query project=team32-ceb returns no resources",
      pass: tagged === "none",
      detail: tagged === undefined ? "not reported" : tagged,
    },
  ];
  if (input.live) {
    criteria.push(
      {
        label: "Live check: no team32-ceb- stacks",
        pass: input.live.remainingStacks.length === 0,
        detail: `${input.live.remainingStacks.length} stacks`,
      },
      {
        label: "Live check: no resources tagged project=team32-ceb",
        pass: input.live.taggedResourceCount === 0,
        detail: `${input.live.taggedResourceCount} resources`,
      },
    );
  }
  return criteria;
}

export function renderCleanup(input: CleanupInput): CleanupVerdict {
  const criteria = evaluateCleanup(input);
  const pass = criteria.every((criterion) => criterion.pass);
  const logLines = input.log.trimEnd().split(/\r?\n/);
  const shown = logLines.slice(-MAX_LOG_LINES);
  const markdown = [
    "# Cleanup evidence (debug sandbox)",
    "",
    `**Verdict: ${pass ? "PASS" : "FAIL"}**`,
    "",
    "Debug-sandbox cleanup proof only. The final verification deployment is left running; the normal `main` pipeline never destroys resources (NFR17, NFR18, NFR20).",
    "",
    `Captured at (UTC): ${input.capturedAt}`,
    "",
    "## Pass criteria (NFR30)",
    "",
    "| Criterion | Detail | Result |",
    "| --- | --- | --- |",
    ...criteria.map(
      (criterion) =>
        `| ${criterion.label} | ${criterion.detail} | ${criterion.pass ? "pass" : "FAIL"} |`,
    ),
    "",
    "## Teardown output",
    "",
    logLines.length > shown.length ? `(first ${logLines.length - shown.length} lines omitted)` : "",
    "",
    "```text",
    ...shown,
    "```",
    "",
  ].join("\n");
  return { pass, criteria, markdown: redact(markdown) };
}

/** Parses the cleanup CLI arguments: --log <file> --exit-status <n> [--no-live]. */
export function parseCleanupArguments(argv: readonly string[]): {
  logPath: string;
  exitStatus: number;
  live: boolean;
} {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const logPath = value("--log");
  const status = value("--exit-status");
  if (!logPath || status === undefined || !/^\d+$/.test(status)) {
    throw new Error(
      "Usage: --log <teardown output file> --exit-status <job exit status> [--no-live]",
    );
  }
  return { logPath, exitStatus: Number(status), live: !argv.includes("--no-live") };
}
