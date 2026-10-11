// Synthetic, unsigned JWTs for tests. They are never valid credentials.

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fakeJwt(claims: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64Url(JSON.stringify(claims)),
    "unsigned-test-signature",
  ].join(".");
}

export const ORGANIZER_SUB = "11111111-1111-4111-8111-111111111111";
export const ADMIN_SUB = "22222222-2222-4222-8222-222222222222";

export function organizerSession(): {
  idToken: string;
  sub: string;
  email: string;
  groups: string[];
  role: "organizer";
} {
  return {
    idToken: fakeJwt({ sub: ORGANIZER_SUB, "cognito:groups": ["organizer"] }),
    sub: ORGANIZER_SUB,
    email: "organizer.one@example.com",
    groups: ["organizer"],
    role: "organizer",
  };
}

export function adminSession(): {
  idToken: string;
  sub: string;
  email: string;
  groups: string[];
  role: "admin";
} {
  return {
    idToken: fakeJwt({ sub: ADMIN_SUB, "cognito:groups": ["admin"] }),
    sub: ADMIN_SUB,
    email: "admin.one@example.com",
    groups: ["admin"],
    role: "admin",
  };
}
