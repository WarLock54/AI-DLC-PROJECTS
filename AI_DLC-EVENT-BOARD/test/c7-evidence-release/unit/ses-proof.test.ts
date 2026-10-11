import { describe, expect, it } from "vitest";
import {
  renderSesProof,
  runSesProof,
  type SesProofInput,
  type SesProofPorts,
} from "../../../scripts/evidence/ses-proof.js";

const input: SesProofInput = {
  environment: { DEBUG_SANDBOX: "true" },
  sender: "sender.person@sender-domain.test",
  recipient: "jane.private@personal-mail.test",
  invokeSelector: false,
};

function ports(overrides: Partial<SesProofPorts> = {}): SesProofPorts & { sent: number } {
  const state = { sent: 0 };
  return Object.assign(state, {
    isIdentityVerified: async () => true,
    sendReminderEmail: async () => {
      state.sent += 1;
      return { messageId: "0100-message-id" };
    },
    nowIso: () => "2026-10-05T12:00:00.000Z",
    ...overrides,
  });
}

describe("SES proof (FR7.6)", () => {
  it("refuses to run without the debug-sandbox opt-in and never touches SES", async () => {
    const p = ports();
    await expect(runSesProof({ ...input, environment: {} }, p)).rejects.toThrow(/DEBUG_SANDBOX/);
    await expect(
      runSesProof({ ...input, environment: { DEBUG_SANDBOX: "yes" } }, p),
    ).rejects.toThrow(/debug sandbox/);
    expect(p.sent).toBe(0);
  });

  it("refuses an unverified recipient or sender identity", async () => {
    const recipientOnly = ports({ isIdentityVerified: async (a) => a !== input.recipient });
    await expect(runSesProof(input, recipientOnly)).rejects.toThrow(/recipient identity/);
    const senderOnly = ports({ isIdentityVerified: async (a) => a !== input.sender });
    await expect(runSesProof(input, senderOnly)).rejects.toThrow(/sender identity/);
    expect(recipientOnly.sent + senderOnly.sent).toBe(0);
  });

  it("refuses synthetic, corporate, and malformed recipients", async () => {
    const p = ports();
    await expect(runSesProof({ ...input, recipient: "a@example.com" }, p)).rejects.toThrow(
      /personal/,
    );
    const corporate = ["a@", "ep", "am", ".com"].join("");
    await expect(runSesProof({ ...input, recipient: corporate }, p)).rejects.toThrow(/Corporate/);
    await expect(runSesProof({ ...input, recipient: "not-an-address" }, p)).rejects.toThrow(
      /email/,
    );
    expect(p.sent).toBe(0);
  });

  it("records success with the message ID and no recipient local part", async () => {
    const record = await runSesProof(input, ports());
    expect(record).toMatchObject({ outcome: "sent", messageId: "0100-message-id" });
    const markdown = renderSesProof(record);
    expect(markdown).toContain("**Verdict: PASS**");
    expect(markdown).toContain("0100-message-id");
    expect(markdown).not.toContain("jane.private");
    expect(markdown).not.toContain("sender.person");
  });

  it("records a provider failure honestly using only the error class", async () => {
    const record = await runSesProof(
      input,
      ports({
        sendReminderEmail: async () => {
          const error = new Error("rejected jane.private@personal-mail.test");
          error.name = "MessageRejected";
          throw error;
        },
      }),
    );
    expect(record).toMatchObject({
      outcome: "failed",
      errorKind: "MessageRejected",
      messageId: null,
    });
    const markdown = renderSesProof(record);
    expect(markdown).toContain("**Verdict: FAIL**");
    expect(markdown).not.toContain("jane.private");
  });

  it("records the optional selector invocation outcome", async () => {
    const ok = await runSesProof(
      { ...input, invokeSelector: true },
      ports({ invokeReminderSelector: async () => {} }),
    );
    expect(ok.selectorInvocation).toBe("succeeded");
    const failed = await runSesProof(
      { ...input, invokeSelector: true },
      ports({
        invokeReminderSelector: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(failed.selectorInvocation).toBe("failed");
    const skipped = await runSesProof(input, ports({ invokeReminderSelector: async () => {} }));
    expect(skipped.selectorInvocation).toBe("not-requested");
  });
});
