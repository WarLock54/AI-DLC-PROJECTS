// D8: organizer/admin sign-in through the SRP-only Cognito app client. Tokens
// live in sessionStorage so they do not outlive the browser tab session.
import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import type { AppConfig } from "../config.js";
import { roleFromGroups, type Role } from "./roles.js";

export interface SessionInfo {
  idToken: string;
  sub: string;
  email: string | null;
  groups: string[];
  role: Role | null;
}

export type SignInErrorKind = "credentials" | "service";

export class SignInError extends Error {
  readonly kind: SignInErrorKind;

  constructor(kind: SignInErrorKind) {
    super(kind === "credentials" ? "Invalid credentials." : "Sign-in service failure.");
    this.name = "SignInError";
    this.kind = kind;
  }
}

export interface AuthService {
  signIn(email: string, password: string): Promise<SessionInfo>;
  getSession(): Promise<SessionInfo | null>;
  signOut(): void;
}

const CREDENTIAL_ERRORS = new Set(["NotAuthorizedException", "UserNotFoundException"]);
const STORAGE_PREFIX = "CognitoIdentityServiceProvider.";

export function createAuthService(
  config: AppConfig,
  storage: Storage = window.sessionStorage,
): AuthService {
  const pool = new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
    Storage: storage,
  });

  const signOut = (): void => {
    pool.getCurrentUser()?.signOut();
    for (const key of Object.keys(storage)) {
      if (key.startsWith(STORAGE_PREFIX)) {
        storage.removeItem(key);
      }
    }
  };

  return {
    signIn: (email, password) => signInWithSrp(pool, storage, email, password),
    getSession: async () => {
      const user = pool.getCurrentUser();
      if (!user) {
        return null;
      }
      try {
        const session = await readSession(user);
        return toSessionInfo(session);
      } catch {
        // An expired session whose refresh failed: sign out rather than keep
        // a stale token the API will reject.
        signOut();
        return null;
      }
    },
    signOut,
  };
}

function signInWithSrp(
  pool: CognitoUserPool,
  storage: Storage,
  email: string,
  password: string,
): Promise<SessionInfo> {
  const user = new CognitoUser({ Username: email, Pool: pool, Storage: storage });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    const unsupportedChallenge = (): void => reject(new SignInError("service"));
    user.authenticateUser(details, {
      onSuccess: (session) => {
        try {
          resolve(toSessionInfo(session));
        } catch {
          reject(new SignInError("service"));
        }
      },
      onFailure: (error: unknown) => {
        const name = typeof error === "object" && error !== null ? errorName(error) : "";
        reject(new SignInError(CREDENTIAL_ERRORS.has(name) ? "credentials" : "service"));
      },
      // Seeded demo users need no challenge flows; any challenge is surfaced as
      // a service error instead of failing silently.
      newPasswordRequired: unsupportedChallenge,
      mfaRequired: unsupportedChallenge,
      totpRequired: unsupportedChallenge,
      selectMFAType: unsupportedChallenge,
      mfaSetup: unsupportedChallenge,
      customChallenge: unsupportedChallenge,
    });
  });
}

function errorName(error: object): string {
  const candidate =
    (error as { code?: unknown; name?: unknown }).code ?? (error as { name?: unknown }).name;
  return typeof candidate === "string" ? candidate : "";
}

function readSession(user: CognitoUser): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.getSession((error: Error | null, session: CognitoUserSession | null) => {
      if (error || !session || !session.isValid()) {
        reject(error ?? new Error("Session is not valid."));
        return;
      }
      resolve(session);
    });
  });
}

function toSessionInfo(session: CognitoUserSession): SessionInfo {
  const idToken = session.getIdToken().getJwtToken();
  const claims = decodeJwtPayload(idToken);
  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    throw new Error("ID token has no subject.");
  }
  const groups = parseGroups(claims["cognito:groups"]);
  return {
    idToken,
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    groups,
    role: roleFromGroups(groups),
  };
}

/** Decodes a JWT payload without verifying it; the API verifies tokens. */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split(".")[1];
  if (!segment) {
    throw new Error("Malformed JWT.");
  }
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Malformed JWT payload.");
  }
  return payload as Record<string, unknown>;
}

/** Accepts both the array claim form and the bracketed-string form "[a b]". */
export function parseGroups(claim: unknown): string[] {
  if (Array.isArray(claim)) {
    return claim.filter((group): group is string => typeof group === "string" && group !== "");
  }
  if (typeof claim === "string") {
    return claim
      .replace(/^\[|\]$/g, "")
      .split(/[\s,]+/)
      .filter((group) => group !== "");
  }
  return [];
}
