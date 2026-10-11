import { randomInt } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  generatePassword,
  isValidDemoPassword,
  seedDemoUsers,
} from "../../../src/seed/demo-users.js";

vi.mock("node:crypto", () => ({
  randomInt: vi.fn((maximum: number) => maximum - 1),
}));

const userPassword = () => generatePassword(() => 0);
const adminPassword = () => generatePassword((maximum) => maximum - 1);
const ORGANIZER_SUBJECT: string = "11111111-1111-4111-8111-111111111111";

function createAdapter(secret: string | undefined) {
  const calls: string[] = [];
  const adapter = {
    readCredentials: vi.fn(async () => secret),
    writeCredentials: vi.fn<(value: string) => Promise<void>>(async () => {
      calls.push("secret");
    }),
    ensureUser: vi.fn(
      async ({ username, group }: { username: string; password: string; group: string }) => {
        calls.push(`user:${username}:${group}`);
        return group === "organizer" ? ORGANIZER_SUBJECT : undefined;
      },
    ),
  };
  return { adapter, calls };
}

function savedCredentials(adapter: ReturnType<typeof createAdapter>["adapter"]) {
  return JSON.parse(adapter.writeCredentials.mock.calls[0][0]) as Record<string, unknown>;
}

describe("Cognito demo password policy", () => {
  it("uses the cryptographic uniform bounded sampler by default", () => {
    expect(isValidDemoPassword(generatePassword())).toBe(true);
    expect(vi.mocked(randomInt).mock.calls.length).toBe(63);
    expect(vi.mocked(randomInt).mock.calls.every(([maximum]) => maximum > 0)).toBe(true);
  });

  it("guarantees all policy classes for deterministic low and high entropy", () => {
    for (const sample of [() => 0, (maximum: number) => maximum - 1]) {
      const password = generatePassword(sample);
      expect(password.length).toBe(32);
      expect(isValidDemoPassword(password)).toBe(true);
    }
  });

  it("accepts the configured minimum length and Cognito maximum length", () => {
    expect(isValidDemoPassword(userPassword().slice(0, 14))).toBe(true);
    expect(isValidDemoPassword(userPassword().repeat(8))).toBe(true);
  });

  it("rejects short, overlong, whitespace, and non-string values", () => {
    const password = userPassword();
    for (const value of [
      password.slice(0, 13),
      password.repeat(9),
      `${password} `,
      null,
      undefined,
      42,
    ]) {
      expect(isValidDemoPassword(value)).toBe(false);
    }
  });

  it("rejects each missing class, including legacy base64url-style values", () => {
    for (const pattern of [/[A-Z]/g, /[a-z]/g, /[0-9]/g, /\^/g]) {
      expect(isValidDemoPassword(userPassword().replace(pattern, ""))).toBe(false);
    }
  });
});

describe("synthetic Cognito demo-user seeding", () => {
  it.each([undefined, "", "{}"])(
    "stores missing credentials before making any identity changes (case %#)",
    async (secret) => {
      const { adapter, calls } = createAdapter(secret);
      const count = await seedDemoUsers(adapter, userPassword);
      expect(count).toEqual({ count: 2, organizerSubject: ORGANIZER_SUBJECT });
      expect(adapter.writeCredentials.mock.calls.length).toBe(1);
      expect(Object.values(savedCredentials(adapter)).every(isValidDemoPassword)).toBe(true);
      expect(calls).toEqual([
        "secret",
        "user:organizer@example.com:organizer",
        "user:admin@example.com:admin",
      ]);
    },
  );

  it("reuses valid stored credentials unchanged, including a 14-character value", async () => {
    const organizerPassword = userPassword().slice(0, 14);
    const password = adminPassword();
    const { adapter } = createAdapter(
      JSON.stringify({ organizerPassword, adminPassword: password }),
    );
    const generator = vi.fn(userPassword);
    await seedDemoUsers(adapter, generator);
    expect(generator.mock.calls.length).toBe(0);
    expect(adapter.writeCredentials.mock.calls.length).toBe(0);
    expect(adapter.ensureUser.mock.calls[0][0].password === organizerPassword).toBe(true);
    expect(adapter.ensureUser.mock.calls[1][0].password === password).toBe(true);
  });

  it("generates only the missing user's password and preserves the valid saved value", async () => {
    const organizerPassword = userPassword();
    const password = adminPassword();
    const { adapter } = createAdapter(JSON.stringify({ organizerPassword }));
    const generator = vi.fn(() => password);
    await seedDemoUsers(adapter, generator);
    const saved = savedCredentials(adapter);
    expect(generator.mock.calls.length).toBe(1);
    expect(saved.organizerPassword === organizerPassword).toBe(true);
    expect(saved.adminPassword === password).toBe(true);
  });

  it.each([null, 42, "", userPassword().replace(/\^/g, "")])(
    "recovers an invalid legacy credential before Cognito changes without logging (case %#)",
    async (legacy) => {
      const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => {}),
      );
      const password = adminPassword();
      const { adapter, calls } = createAdapter(
        JSON.stringify({ organizerPassword: legacy, adminPassword: password }),
      );
      const generator = vi.fn(userPassword);
      await seedDemoUsers(adapter, generator);
      const saved = savedCredentials(adapter);
      expect(generator.mock.calls.length).toBe(1);
      expect(isValidDemoPassword(saved.organizerPassword)).toBe(true);
      expect(saved.adminPassword === password).toBe(true);
      expect(calls[0]).toBe("secret");
      expect(logs.every((log) => log.mock.calls.length === 0)).toBe(true);
    },
  );

  it.each(["not-json", "null", "[]", "42"])(
    "rejects malformed stored objects before any writes or identity changes (case %#)",
    async (secret) => {
      const { adapter } = createAdapter(secret);
      await expect(seedDemoUsers(adapter)).rejects.toThrow(/valid JSON object/);
      expect(adapter.writeCredentials.mock.calls.length).toBe(0);
      expect(adapter.ensureUser.mock.calls.length).toBe(0);
    },
  );

  it("rejects a bad injected generator before persisting even a partially prepared replacement", async () => {
    const { adapter } = createAdapter("{}");
    const generator = vi
      .fn(userPassword)
      .mockReturnValueOnce(userPassword())
      .mockReturnValueOnce(userPassword().replace(/\^/g, ""));
    await expect(seedDemoUsers(adapter, generator)).rejects.toThrow(/Cognito password policy/);
    expect(adapter.writeCredentials.mock.calls.length).toBe(0);
    expect(adapter.ensureUser.mock.calls.length).toBe(0);
  });

  it("waits for successful replacement storage before calling Cognito", async () => {
    const { adapter } = createAdapter("{}");
    let acknowledgeWrite!: () => void;
    adapter.writeCredentials.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledgeWrite = resolve;
        }),
    );
    const seeding = seedDemoUsers(adapter, userPassword);
    await vi.waitFor(() => expect(adapter.writeCredentials.mock.calls.length).toBe(1));
    expect(adapter.ensureUser.mock.calls.length).toBe(0);
    acknowledgeWrite();
    await expect(seeding).resolves.toEqual({
      count: 2,
      organizerSubject: ORGANIZER_SUBJECT,
    });
  });

  it("surfaces secret read and replacement-write failures without changing users", async () => {
    const { adapter } = createAdapter("{}");
    adapter.readCredentials.mockRejectedValueOnce(new Error("secret read unavailable"));
    await expect(seedDemoUsers(adapter, userPassword)).rejects.toThrow("secret read unavailable");
    expect(adapter.writeCredentials.mock.calls.length).toBe(0);
    adapter.writeCredentials.mockRejectedValueOnce(new Error("secret store unavailable"));
    await expect(seedDemoUsers(adapter, userPassword)).rejects.toThrow("secret store unavailable");
    expect(adapter.ensureUser.mock.calls.length).toBe(0);
  });

  it("surfaces Cognito failures and reuses safely stored replacements on retry", async () => {
    const { adapter } = createAdapter("{}");
    adapter.ensureUser.mockRejectedValueOnce(new Error("Cognito unavailable"));
    await expect(seedDemoUsers(adapter, userPassword)).rejects.toThrow("Cognito unavailable");
    expect(adapter.ensureUser.mock.calls.length).toBe(1);
    adapter.readCredentials.mockResolvedValue(adapter.writeCredentials.mock.calls[0][0]);
    const generator = vi.fn(adminPassword);
    await expect(seedDemoUsers(adapter, generator)).resolves.toEqual({
      count: 2,
      organizerSubject: ORGANIZER_SUBJECT,
    });
    expect(generator.mock.calls.length).toBe(0);
    expect(adapter.writeCredentials.mock.calls.length).toBe(1);
  });

  it.each([undefined, "not-a-cognito-subject"])(
    "fails when Cognito omits or malforms the organizer subject (case %#)",
    async (subject) => {
      const { adapter } = createAdapter(
        JSON.stringify({
          organizerPassword: userPassword(),
          adminPassword: adminPassword(),
        }),
      );
      adapter.ensureUser.mockResolvedValueOnce(subject);
      await expect(seedDemoUsers(adapter)).rejects.toThrow(
        /valid subject for the seeded organizer/,
      );
      expect(adapter.ensureUser).toHaveBeenCalledTimes(1);
    },
  );
});
