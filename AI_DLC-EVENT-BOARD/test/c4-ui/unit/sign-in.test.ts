import { describe, expect, it } from "vitest";
import { SignInError, type SessionInfo } from "../../../ui/src/auth/session.js";
import { COPY } from "../../../ui/src/copy.js";
import { liveText, setValue, startApp, submit, type Harness } from "./support/app.js";
import { flush } from "./support/fake-api.js";
import { adminSession, organizerSession } from "./support/jwt.js";

function fill(harness: Harness, password = "synthetic-password"): void {
  setValue(harness.byTestId<HTMLInputElement>("sign-in-email"), "organizer.one@example.com");
  setValue(harness.byTestId<HTMLInputElement>("sign-in-password"), password);
  submit(harness.byTestId<HTMLFormElement>("sign-in-form"));
}

function succeedWith(harness: Harness, session: SessionInfo): void {
  harness.auth.signIn.mockImplementation(async () => {
    harness.auth.session = session;
    return session;
  });
}

describe("organizer/admin sign-in (D8, D9, US2.1)", () => {
  it("disables the button and announces loading while Cognito is pending", async () => {
    const harness = await startApp("/sign-in");
    let release: (session: SessionInfo) => void = () => undefined;
    harness.auth.signIn.mockImplementation(
      () => new Promise<SessionInfo>((resolve) => (release = resolve)),
    );
    fill(harness);
    expect(harness.byTestId<HTMLButtonElement>("sign-in-submit").disabled).toBe(true);
    expect(liveText()).toBe(COPY.signingIn);
    submit(harness.byTestId<HTMLFormElement>("sign-in-form"));
    expect(harness.auth.signIn).toHaveBeenCalledTimes(1);
    harness.auth.session = organizerSession();
    release(organizerSession());
    await flush();
  });

  it("gives a non-disclosing message for wrong credentials, keeps the email, clears the password", async () => {
    const harness = await startApp("/sign-in");
    harness.auth.signIn.mockRejectedValue(new SignInError("credentials"));
    fill(harness);
    await flush();
    expect(harness.byTestId("sign-in-error").textContent).toBe(COPY.signInIncorrect);
    expect(harness.byTestId<HTMLInputElement>("sign-in-email").value).toBe(
      "organizer.one@example.com",
    );
    expect(harness.byTestId<HTMLInputElement>("sign-in-password").value).toBe("");
    expect(document.querySelector('[data-testid="sign-in-retry"]')).toBeNull();
  });

  it("shows a distinct service error with Retry that resubmits", async () => {
    const harness = await startApp("/sign-in");
    harness.auth.signIn.mockRejectedValueOnce(new SignInError("service"));
    fill(harness);
    await flush();
    expect(harness.byTestId("sign-in-error").textContent).toBe(COPY.signInService);
    expect(COPY.signInService).not.toBe(COPY.signInIncorrect);
    succeedWith(harness, organizerSession());
    harness.byTestId("sign-in-retry").click();
    await flush();
    expect(harness.auth.signIn).toHaveBeenCalledTimes(2);
    expect(window.location.pathname).toBe("/organizer/events");
  });

  it("returns to a valid returnTo after success", async () => {
    const harness = await startApp(`/sign-in?returnTo=${encodeURIComponent("/admin/stats")}`);
    succeedWith(harness, adminSession());
    fill(harness);
    await flush();
    expect(window.location.pathname).toBe("/admin/stats");
    expect(document.querySelector("main h1")?.textContent).toBe("Event statistics");
  });

  it("falls back to the role default for an invalid returnTo", async () => {
    const harness = await startApp(`/sign-in?returnTo=${encodeURIComponent("//evil.example/x")}`);
    succeedWith(harness, adminSession());
    fill(harness);
    await flush();
    expect(window.location.pathname).toBe("/admin/events");
  });

  it("sends an organizer asking for /admin/stats to /organizer/events", async () => {
    const harness = await startApp(`/sign-in?returnTo=${encodeURIComponent("/admin/stats")}`);
    succeedWith(harness, organizerSession());
    fill(harness);
    await flush();
    expect(window.location.pathname).toBe("/organizer/events");
    expect(harness.api.requestsTo("GET", "/api/admin/stats")).toHaveLength(0);
  });

  it("asks for both fields before calling Cognito", async () => {
    const harness = await startApp("/sign-in");
    fill(harness, "");
    await flush();
    expect(harness.auth.signIn).not.toHaveBeenCalled();
    expect(harness.byTestId("sign-in-error").textContent).toBe("Enter your email and password.");
    expect(harness.byTestId("sign-in-email").getAttribute("aria-describedby")).toBe(
      "sign-in-feedback",
    );
  });
});
