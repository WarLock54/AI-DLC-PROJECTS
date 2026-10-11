// Debug-sandbox evidence files start as clearly marked placeholders. The CLIs
// overwrite them with real results; nothing here ever fabricates a result.

export const PENDING_MARKER = "Pending debug-sandbox run";

export function pendingDocument(options: {
  title: string;
  requirement: string;
  command: string;
  environment: string;
}): string {
  return [
    `# ${options.title}`,
    "",
    `**Status: ${PENDING_MARKER}.** No result has been recorded yet.`,
    "",
    `This file is overwritten by \`${options.command}\` when it runs in the debug sandbox (${options.requirement}).`,
    `Required opt-in: \`${options.environment}\`. See \`docs/release-runbook.md\`.`,
    "The final verification pipeline never produces this evidence.",
    "",
  ].join("\n");
}

export function isPending(markdown: string): boolean {
  return markdown.includes(PENDING_MARKER);
}
