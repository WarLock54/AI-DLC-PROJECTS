import { createHash, randomBytes } from "node:crypto";

// D6: 32 random bytes, base64url, returned once. Only the SHA-256 hex digest is
// stored, the same digest form the C1 seed uses. The raw token is never logged.
export const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedToken {
  token: string;
  digest: string;
}

export function issueCancelToken(random: (size: number) => Buffer = randomBytes): IssuedToken {
  const token = random(TOKEN_BYTES).toString("base64url");
  return { token, digest: digestToken(token) };
}

export function digestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isWellFormedToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
