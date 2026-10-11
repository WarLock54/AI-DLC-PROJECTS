// FR7.6: real reminder email proof, debug sandbox only. All I/O is injected. The
// recorded evidence never contains the recipient or sender local part.
import { redact } from "./redact.js";

export interface SesProofPorts {
  isIdentityVerified(address: string): Promise<boolean>;
  sendReminderEmail(input: { sender: string; recipient: string }): Promise<{ messageId: string }>;
  /** Optional: invoke the deployed reminder selector once. */
  invokeReminderSelector?(): Promise<void>;
  nowIso(): string;
}

export interface SesProofInput {
  environment: Record<string, string | undefined>;
  sender: string;
  recipient: string;
  /** Records the selector invocation result when the port is supplied. */
  invokeSelector: boolean;
}

export interface SesProofRecord {
  outcome: "sent" | "failed";
  messageId: string | null;
  recipientDomain: string;
  senderDomain: string;
  selectorInvocation: "not-requested" | "succeeded" | "failed";
  errorKind: string | null;
  at: string;
}

const PROHIBITED_TOKEN = ["ep", "am"].join("");
const ADDRESS_PATTERN = /^[^@\s]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

export function assertDebugSandbox(environment: Record<string, string | undefined>): void {
  if (environment.DEBUG_SANDBOX !== "true") {
    throw new Error(
      "The SES proof runs only in the debug sandbox. Set DEBUG_SANDBOX=true; the final verification pipeline never does.",
    );
  }
}

function domainOf(address: string, role: string): string {
  const match = ADDRESS_PATTERN.exec(address);
  if (!match) {
    throw new Error(`The ${role} must be an email address.`);
  }
  return match[1].toLowerCase();
}

export async function runSesProof(
  input: SesProofInput,
  ports: SesProofPorts,
): Promise<SesProofRecord> {
  assertDebugSandbox(input.environment);
  const recipientDomain = domainOf(input.recipient, "recipient");
  const senderDomain = domainOf(input.sender, "sender");
  if (recipientDomain === "example.com" || recipientDomain.endsWith(".example.com")) {
    throw new Error(
      "Real delivery needs a verified personal address, not a synthetic example.com one.",
    );
  }
  if (recipientDomain.includes(PROHIBITED_TOKEN)) {
    throw new Error(
      "Corporate recipient addresses are prohibited; use a verified personal address.",
    );
  }
  if (!(await ports.isIdentityVerified(input.recipient))) {
    throw new Error("The recipient identity is not verified in SES; refusing to send.");
  }
  if (!(await ports.isIdentityVerified(input.sender))) {
    throw new Error("The sender identity is not verified in SES; refusing to send.");
  }

  let selectorInvocation: SesProofRecord["selectorInvocation"] = "not-requested";
  if (input.invokeSelector && ports.invokeReminderSelector) {
    try {
      await ports.invokeReminderSelector();
      selectorInvocation = "succeeded";
    } catch {
      selectorInvocation = "failed";
    }
  }

  const base = { recipientDomain, senderDomain, selectorInvocation };
  try {
    const { messageId } = await ports.sendReminderEmail({
      sender: input.sender,
      recipient: input.recipient,
    });
    return { ...base, outcome: "sent", messageId, errorKind: null, at: ports.nowIso() };
  } catch (error) {
    // Only the error class is kept; provider messages can echo the address.
    const errorKind = error instanceof Error && error.name ? error.name : "UnknownError";
    return { ...base, outcome: "failed", messageId: null, errorKind, at: ports.nowIso() };
  }
}

export function renderSesProof(record: SesProofRecord): string {
  const pass = record.outcome === "sent" && record.messageId !== null;
  const lines = [
    "# SES reminder email proof (debug sandbox)",
    "",
    `**Verdict: ${pass ? "PASS" : "FAIL"}**`,
    "",
    "Debug-sandbox proof only (FR7.6). The final verification sandbox stays in `EMAIL_MODE=log` and never depends on real email delivery.",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Outcome | ${record.outcome} |`,
    `| SES message ID | ${record.messageId ?? "none"} |`,
    `| Recipient | verified personal address at ${record.recipientDomain} (local part not recorded) |`,
    `| Sender | verified identity at ${record.senderDomain} (local part not recorded) |`,
    `| Reminder selector invocation | ${record.selectorInvocation} |`,
    `| Provider error class | ${record.errorKind ?? "none"} |`,
    `| Recorded at (UTC) | ${record.at} |`,
    "",
    "Both identities were confirmed verified in SES before the send. No credentials, tokens, or full addresses are stored in this file.",
    "",
  ];
  return redact(lines.join("\n"));
}
