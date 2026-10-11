import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthService, parseGroups, SignInError } from "../../../ui/src/auth/session.js";
import { fakeJwt, ORGANIZER_SUB } from "./support/jwt.js";

interface FakeCallbacks {
  onSuccess: (session: unknown) => void;
  onFailure: (error: unknown) => void;
  newPasswordRequired: () => void;
}

// Shared state for the mocked library, hoisted above vi.mock.
const cognito = vi.hoisted(() => ({
  poolStorage: undefined as Storage | undefined,
  userStorage: undefined as Storage | undefined,
  authenticate: (callbacks: FakeCallbacks): void => void callbacks,
  currentUser: null as null | {
    getSession: (callback: (error: Error | null, session: unknown) => void) => void;
    signOut: () => void;
  },
}));

vi.mock("amazon-cognito-identity-js", () => {
  class CognitoUserPool {
    constructor(data: { Storage: Storage }) {
      cognito.poolStorage = data.Storage;
    }
    getCurrentUser(): typeof cognito.currentUser {
      return cognito.currentUser;
    }
  }
  class AuthenticationDetails {
    constructor(readonly data: unknown) {}
  }
  class CognitoUser {
    constructor(data: { Storage: Storage }) {
      cognito.userStorage = data.Storage;
    }
    authenticateUser(_details: unknown, callbacks: FakeCallbacks): void {
      cognito.authenticate(callbacks);
    }
  }
  return { CognitoUserPool, CognitoUser, AuthenticationDetails };
});

const CONFIG = {
  region: "us-east-1",
  userPoolId: "us-east-1_TestPool1",
  userPoolClientId: "testclient123",
};

function fakeSession(claims: Record<string, unknown>) {
  const token = fakeJwt(claims);
  return { getIdToken: () => ({ getJwtToken: () => token }), isValid: () => true };
}

function namedError(name: string): Error {
  return Object.assign(new Error("synthetic"), { name, code: name });
}

describe("Cognito session wrapper (D8)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    cognito.currentUser = null;
  });

  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("signs in with SRP and keeps tokens in sessionStorage only", async () => {
    cognito.authenticate = (callbacks) => {
      cognito.userStorage?.setItem("CognitoIdentityServiceProvider.client.idToken", "x");
      callbacks.onSuccess(fakeSession({ sub: ORGANIZER_SUB, "cognito:groups": ["organizer"] }));
    };
    const auth = createAuthService(CONFIG);
    const session = await auth.signIn("organizer.one@example.com", "synthetic-password");
    expect(session).toMatchObject({ sub: ORGANIZER_SUB, role: "organizer", groups: ["organizer"] });
    expect(cognito.poolStorage).toBe(window.sessionStorage);
    expect(cognito.userStorage).toBe(window.sessionStorage);
    expect(window.localStorage.length).toBe(0);
  });

  it("reads groups from the array and the bracketed-string claim forms", async () => {
    expect(parseGroups(["admin", "organizer"])).toEqual(["admin", "organizer"]);
    expect(parseGroups("[admin organizer]")).toEqual(["admin", "organizer"]);
    expect(parseGroups(undefined)).toEqual([]);
    cognito.authenticate = (callbacks) =>
      callbacks.onSuccess(
        fakeSession({ sub: ORGANIZER_SUB, "cognito:groups": "[admin organizer]" }),
      );
    const session = await createAuthService(CONFIG).signIn("a@example.com", "pw");
    expect(session.role).toBe("admin");
  });

  it("gives the same credential error for a wrong password and an unknown user", async () => {
    const auth = createAuthService(CONFIG);
    const kinds: string[] = [];
    for (const name of ["NotAuthorizedException", "UserNotFoundException"]) {
      cognito.authenticate = (callbacks) => callbacks.onFailure(namedError(name));
      const error = await auth.signIn("a@example.com", "pw").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(SignInError);
      kinds.push((error as SignInError).kind);
    }
    expect(kinds).toEqual(["credentials", "credentials"]);
  });

  it("reports a distinct service error for other Cognito failures and challenges", async () => {
    const auth = createAuthService(CONFIG);
    cognito.authenticate = (callbacks) => callbacks.onFailure(namedError("InternalErrorException"));
    await expect(auth.signIn("a@example.com", "pw")).rejects.toMatchObject({ kind: "service" });
    cognito.authenticate = (callbacks) => callbacks.newPasswordRequired();
    await expect(auth.signIn("a@example.com", "pw")).rejects.toMatchObject({ kind: "service" });
  });

  it("returns the current session, refreshed by the library", async () => {
    cognito.currentUser = {
      getSession: (callback) =>
        callback(null, fakeSession({ sub: ORGANIZER_SUB, "cognito:groups": ["organizer"] })),
      signOut: vi.fn(),
    };
    await expect(createAuthService(CONFIG).getSession()).resolves.toMatchObject({
      sub: ORGANIZER_SUB,
      role: "organizer",
    });
  });

  it("signs out when the session refresh fails", async () => {
    const signOut = vi.fn();
    window.sessionStorage.setItem("CognitoIdentityServiceProvider.client.refreshToken", "x");
    cognito.currentUser = {
      getSession: (callback) => callback(new Error("Refresh Token has expired"), null),
      signOut,
    };
    await expect(createAuthService(CONFIG).getSession()).resolves.toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("clears stored Cognito tokens on sign-out and reports no session afterwards", async () => {
    window.sessionStorage.setItem("CognitoIdentityServiceProvider.client.idToken", "x");
    window.sessionStorage.setItem("unrelated", "kept");
    const auth = createAuthService(CONFIG);
    auth.signOut();
    expect(
      window.sessionStorage.getItem("CognitoIdentityServiceProvider.client.idToken"),
    ).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("kept");
    await expect(auth.getSession()).resolves.toBeNull();
  });
});
