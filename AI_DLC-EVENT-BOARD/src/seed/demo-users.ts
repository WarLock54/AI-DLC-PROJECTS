import { randomInt } from "node:crypto";

const PASSWORD_CHARACTER_CLASSES = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "^$*.[]{}()?-\"!@#%&/\\,><':;|_~`+=",
] as const;
const PASSWORD_ALPHABET = PASSWORD_CHARACTER_CLASSES.join("");
const GENERATED_PASSWORD_LENGTH = 32;

export function isValidDemoPassword(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 14 &&
    value.length <= 256 &&
    !/\s/.test(value) &&
    PASSWORD_CHARACTER_CLASSES.every((characters) =>
      [...value].some((character) => characters.includes(character)),
    )
  );
}

export function generatePassword(randomIndex: (maximum: number) => number = randomInt): string {
  const pick = (characters: string): string => characters[randomIndex(characters.length)];
  const characters = PASSWORD_CHARACTER_CLASSES.map(pick);
  while (characters.length < GENERATED_PASSWORD_LENGTH) {
    characters.push(pick(PASSWORD_ALPHABET));
  }
  // Uniform bounded sampling and Fisher-Yates avoid modulo bias and fixed class positions.
  for (let index = characters.length - 1; index > 0; index--) {
    const other = randomIndex(index + 1);
    [characters[index], characters[other]] = [characters[other], characters[index]];
  }
  return validateGeneratedPassword(characters.join(""));
}

function validateGeneratedPassword(password: string): string {
  if (!isValidDemoPassword(password)) {
    throw new Error("Generated demo password does not satisfy the Cognito password policy.");
  }
  return password;
}

const DEMO_USERS = [
  { username: "organizer@example.com", secretKey: "organizerPassword", group: "organizer" },
  { username: "admin@example.com", secretKey: "adminPassword", group: "admin" },
] as const;

type CredentialKey = (typeof DEMO_USERS)[number]["secretKey"];

export interface DemoUserAdapter {
  readCredentials(): Promise<string | undefined>;
  writeCredentials(value: string): Promise<void>;
  ensureUser(input: {
    username: string;
    password: string;
    group: string;
  }): Promise<string | undefined>;
}

export interface SeedDemoUsersResult {
  count: number;
  organizerSubject: string;
}

export async function seedDemoUsers(
  adapter: DemoUserAdapter,
  passwordGenerator: () => string = generatePassword,
): Promise<SeedDemoUsersResult> {
  const stored = parseCredentials(await adapter.readCredentials());
  const credentials: Record<CredentialKey, string> = {
    organizerPassword: stored.organizerPassword ?? validateGeneratedPassword(passwordGenerator()),
    adminPassword: stored.adminPassword ?? validateGeneratedPassword(passwordGenerator()),
  };
  if (
    credentials.organizerPassword !== stored.organizerPassword ||
    credentials.adminPassword !== stored.adminPassword
  ) {
    await adapter.writeCredentials(JSON.stringify(credentials));
  }

  let organizerSubject: string | undefined;
  for (const user of DEMO_USERS) {
    const subject = await adapter.ensureUser({
      username: user.username,
      password: credentials[user.secretKey],
      group: user.group,
    });
    if (user.group === "organizer") {
      if (!subject || !isValidCognitoSubject(subject)) {
        throw new Error("Cognito did not return a valid subject for the seeded organizer.");
      }
      organizerSubject = subject;
    }
  }
  if (!organizerSubject) {
    throw new Error("Cognito did not return a valid subject for the seeded organizer.");
  }
  return { count: DEMO_USERS.length, organizerSubject };
}

function isValidCognitoSubject(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseCredentials(value: string | undefined): Partial<Record<CredentialKey, string>> {
  if (!value) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Demo credential secret must contain a valid JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Demo credential secret must contain a valid JSON object.");
  }
  const record = parsed as Record<string, unknown>;
  const credentials: Partial<Record<CredentialKey, string>> = {};
  for (const key of ["organizerPassword", "adminPassword"] as const) {
    const candidate = record[key];
    if (isValidDemoPassword(candidate)) {
      credentials[key] = candidate;
    }
  }
  return credentials;
}
