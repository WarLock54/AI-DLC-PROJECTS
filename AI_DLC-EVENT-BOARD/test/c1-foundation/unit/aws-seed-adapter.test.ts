import type { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetSecretValueCommand, PutSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { AwsSeedAdapter } from "../../../src/seed/aws-adapter.js";
import { generatePassword, seedDemoUsers } from "../../../src/seed/demo-users.js";

const ORGANIZER_SUBJECT = "11111111-1111-4111-8111-111111111111";

function createAdapter(
  cognitoSend: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
  secretsSend: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue({}),
) {
  const cognito = { send: cognitoSend } as unknown as CognitoIdentityProviderClient;
  const secrets = { send: secretsSend } as unknown as SecretsManagerClient;
  return {
    adapter: new AwsSeedAdapter(secrets, cognito, "secret-arn", "pool-id"),
    cognitoSend,
    secretsSend,
  };
}

describe("AWS SDK seed boundary adapter", () => {
  it("reads the demo credential JSON only from the configured Secrets Manager secret", async () => {
    const secretsSend = vi.fn().mockResolvedValue({ SecretString: '{"organizerPassword":"x"}' });
    const { adapter } = createAdapter(vi.fn(), secretsSend);
    expect((await adapter.readCredentials()) === '{"organizerPassword":"x"}').toBe(true);
    expect(secretsSend.mock.calls[0][0] instanceof GetSecretValueCommand).toBe(true);
    expect(secretsSend.mock.calls[0][0].input.SecretId).toBe("secret-arn");
  });

  it("stores only the serialized demo credential object in the configured secret", async () => {
    const secretsSend = vi.fn().mockResolvedValue({});
    const { adapter } = createAdapter(vi.fn(), secretsSend);
    const secretValue = JSON.stringify({ adminPassword: generatePassword(() => 0) });
    await adapter.writeCredentials(secretValue);
    expect(secretsSend.mock.calls[0][0] instanceof PutSecretValueCommand).toBe(true);
    expect(secretsSend.mock.calls[0][0].input.SecretId).toBe("secret-arn");
    expect(secretsSend.mock.calls[0][0].input.SecretString === secretValue).toBe(true);
  });

  it("suppresses Cognito invitations and installs the exact synthetic user group", async () => {
    const missingUser = Object.assign(new Error("not found"), { name: "UserNotFoundException" });
    const cognitoSend = vi
      .fn()
      .mockRejectedValueOnce(missingUser)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ UserAttributes: [{ Name: "sub", Value: ORGANIZER_SUBJECT }] });
    const { adapter } = createAdapter(cognitoSend);
    const password = generatePassword(() => 0);
    await expect(
      adapter.ensureUser({
        username: "organizer@example.com",
        password,
        group: "organizer",
      }),
    ).resolves.toBe(ORGANIZER_SUBJECT);
    expect(cognitoSend.mock.calls[1][0] instanceof AdminCreateUserCommand).toBe(true);
    expect(cognitoSend.mock.calls[1][0].input).toMatchObject({
      Username: "organizer@example.com",
      MessageAction: "SUPPRESS",
      UserAttributes: [
        { Name: "email", Value: "organizer@example.com" },
        { Name: "email_verified", Value: "true" },
      ],
    });
    expect(cognitoSend.mock.calls[2][0] instanceof AdminSetUserPasswordCommand).toBe(true);
    expect(cognitoSend.mock.calls[2][0].input.Permanent).toBe(true);
    expect(cognitoSend.mock.calls[2][0].input.Password === password).toBe(true);
    expect(cognitoSend.mock.calls[3][0] instanceof AdminAddUserToGroupCommand).toBe(true);
    expect(cognitoSend.mock.calls[3][0].input.GroupName).toBe("organizer");
    expect(cognitoSend.mock.calls[4][0] instanceof AdminGetUserCommand).toBe(true);
    expect(cognitoSend.mock.calls[4][0].input.Username).toBe("organizer@example.com");
  });

  it("keeps an existing Cognito user idempotent without sending another invitation", async () => {
    const cognitoSend = vi.fn().mockResolvedValue({});
    const { adapter } = createAdapter(cognitoSend);
    const password = generatePassword(() => 0);
    await adapter.ensureUser({
      username: "admin@example.com",
      password,
      group: "admin",
    });
    expect(cognitoSend.mock.calls.length).toBe(3);
    expect(cognitoSend.mock.calls[0][0] instanceof AdminCreateUserCommand).toBe(false);
    expect(cognitoSend.mock.calls[2][0].input.GroupName).toBe("admin");
  });

  it("requires the ensured organizer to be readable with an actual Cognito subject", async () => {
    const cognitoSend = vi.fn().mockResolvedValue({});
    const { adapter } = createAdapter(cognitoSend);
    await expect(
      adapter.ensureUser({
        username: "organizer@example.com",
        password: generatePassword(() => 0),
        group: "organizer",
      }),
    ).rejects.toThrow(/did not return a subject/);
    expect(cognitoSend.mock.calls.at(-1)?.[0]).toBeInstanceOf(AdminGetUserCommand);
  });

  it("surfaces Cognito service errors without continuing to password or group changes", async () => {
    const cognitoSend = vi.fn().mockRejectedValue(new Error("Cognito unavailable"));
    const { adapter } = createAdapter(cognitoSend);
    const password = generatePassword(() => 0);
    await expect(
      adapter.ensureUser({
        username: "admin@example.com",
        password,
        group: "admin",
      }),
    ).rejects.toThrow("Cognito unavailable");
    expect(cognitoSend.mock.calls.length).toBe(1);
  });

  it("surfaces Secrets Manager read failures", async () => {
    const secretsSend = vi.fn().mockRejectedValue(new Error("Secrets Manager unavailable"));
    const { adapter } = createAdapter(vi.fn(), secretsSend);
    await expect(adapter.readCredentials()).rejects.toThrow("Secrets Manager unavailable");
  });

  it.each(["AdminCreateUserCommand", "AdminSetUserPasswordCommand", "AdminAddUserToGroupCommand"])(
    "surfaces Cognito mutation failures and stops at the failed operation (case %#)",
    async (operation) => {
      const calls: string[] = [];
      const cognitoSend = vi.fn(async (command) => {
        const name = command.constructor.name;
        calls.push(name);
        if (name === "AdminGetUserCommand") {
          throw Object.assign(new Error("not found"), { name: "UserNotFoundException" });
        }
        if (name === operation) {
          throw new Error("Cognito mutation unavailable");
        }
        return {};
      });
      const { adapter } = createAdapter(cognitoSend);
      await expect(
        adapter.ensureUser({
          username: "organizer@example.com",
          password: generatePassword(() => 0),
          group: "organizer",
        }),
      ).rejects.toThrow("Cognito mutation unavailable");
      expect(calls.at(-1)).toBe(operation);
    },
  );

  it("rejects policy-invalid passwords at the SDK boundary before any Cognito calls", async () => {
    const { adapter, cognitoSend } = createAdapter();
    await expect(
      adapter.ensureUser({
        username: "organizer@example.com",
        password: generatePassword(() => 0).replace(/\^/g, ""),
        group: "organizer",
      }),
    ).rejects.toThrow(/Cognito password policy/);
    expect(cognitoSend.mock.calls.length).toBe(0);
  });

  it("persists legacy replacements through Secrets Manager before Cognito and blocks on write failure", async () => {
    const calls: string[] = [];
    const secretsSend = vi.fn(async (command) => {
      calls.push(command.constructor.name);
      if (command instanceof GetSecretValueCommand) {
        return { SecretString: JSON.stringify({ organizerPassword: null, adminPassword: null }) };
      }
      return {};
    });
    const cognitoSend = vi.fn(async (command) => {
      calls.push(command.constructor.name);
      if (
        command instanceof AdminGetUserCommand &&
        calls.filter((name) => name === "AdminGetUserCommand").length > 1
      ) {
        return { UserAttributes: [{ Name: "sub", Value: ORGANIZER_SUBJECT }] };
      }
      return {};
    });
    const { adapter } = createAdapter(cognitoSend, secretsSend);
    await expect(seedDemoUsers(adapter, () => generatePassword(() => 0))).resolves.toEqual({
      count: 2,
      organizerSubject: ORGANIZER_SUBJECT,
    });
    expect(calls.slice(0, 3)).toEqual([
      "GetSecretValueCommand",
      "PutSecretValueCommand",
      "AdminGetUserCommand",
    ]);
    cognitoSend.mockClear();
    secretsSend.mockImplementationOnce(async () => ({
      SecretString: JSON.stringify({ organizerPassword: null, adminPassword: null }),
    }));
    secretsSend.mockRejectedValueOnce(new Error("replacement storage unavailable"));
    await expect(seedDemoUsers(adapter, () => generatePassword(() => 0))).rejects.toThrow(
      "replacement storage unavailable",
    );
    expect(cognitoSend.mock.calls.length).toBe(0);
  });
});
