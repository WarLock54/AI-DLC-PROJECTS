import { describe, expect, it, vi } from "vitest";
import { COPY } from "../../../ui/src/copy.js";
import { setValue, startApp, submit } from "./support/app.js";
import { errorBody, FakeApi, flush } from "./support/fake-api.js";

const MARKET = "/events/seed-event-community-market";

function stubClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: spy }, configurable: true });
  return spy;
}

async function fillRsvp(byTestId: (id: string) => HTMLElement, email = "resident.two@example.com") {
  setValue(byTestId("rsvp-display-name") as HTMLInputElement, "Synthetic Resident Two");
  setValue(byTestId("rsvp-email") as HTMLInputElement, email);
  submit(byTestId("rsvp-form") as HTMLFormElement);
  await flush();
}

describe("event detail, copy link, and RSVP (D11, US1.2, US1.3)", () => {
  it("renders the same detail when opened directly by its stable URL", async () => {
    const { api, byTestId } = await startApp(MARKET);
    expect(document.querySelector("main h1")?.textContent).toBe("Community Market");
    expect(byTestId("event-description").textContent).toContain("Synthetic event fixture");
    expect(byTestId("event-detail").textContent).toContain("1 of 50 places taken");
    expect(api.requestsTo("GET", "/api/events/seed-event-community-market")).toHaveLength(1);
    expect(document.title).toBe("Community Market · Community Event Board");
  });

  it("shows the unavailable state with a back link for an unknown event", async () => {
    const { byTestId } = await startApp("/events/no-such-event");
    expect(document.querySelector("main h1")?.textContent).toBe(COPY.eventUnavailable);
    expect(byTestId("event-unavailable-back").getAttribute("href")).toBe("/events");
    expect(document.body.textContent).not.toContain("NOT_FOUND");
  });

  it("copies the canonical detail URL", async () => {
    const writeText = stubClipboard(async () => undefined);
    const { byTestId } = await startApp(MARKET);
    byTestId("event-copy-link").click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/events/seed-event-community-market`,
    );
    expect(byTestId("event-copy-status").textContent).toBe(COPY.copyLinkDone);
  });

  it("shows a selectable read-only field when the clipboard fails", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const { byTestId } = await startApp(MARKET);
    byTestId("event-copy-link").click();
    await flush();
    const field = byTestId<HTMLInputElement>("event-copy-fallback");
    expect(byTestId("event-copy-fallback-group").hidden).toBe(false);
    expect(field.hasAttribute("readonly")).toBe(true);
    expect(field.value).toBe(`${window.location.origin}/events/seed-event-community-market`);
  });

  it("shows Confirmed with a one-time cancellation link carrying the token only in the fragment", async () => {
    const { api, byTestId } = await startApp(MARKET);
    await fillRsvp(byTestId);
    expect(api.requestsTo("POST", "/api/events/seed-event-community-market/rsvps")[0].body).toEqual(
      {
        displayName: "Synthetic Resident Two",
        email: "resident.two@example.com",
      },
    );
    expect(byTestId("rsvp-result-heading").textContent).toBe(COPY.rsvpConfirmed);
    expect(document.activeElement).toBe(byTestId("rsvp-result-heading"));
    const href = byTestId("rsvp-cancel-link").getAttribute("href") ?? "";
    const url = new URL(href, "https://site.test");
    expect(url.pathname).toBe("/rsvp/cancel");
    expect(url.searchParams.get("event")).toBe("seed-event-community-market");
    expect(url.searchParams.get("joined")).toBe("confirmed");
    expect(url.search).not.toContain("synthetic-cancel-token");
    expect(url.hash).toBe("#token=synthetic-cancel-token-0001");
    expect(document.body.textContent).not.toContain("synthetic-cancel-token-0001");
  });

  it("shows Waitlisted for a full event and the existing status for a duplicate", async () => {
    const { api, byTestId } = await startApp("/events/synthetic-event-river-cleanup");
    await fillRsvp(byTestId);
    expect(byTestId("rsvp-result-heading").textContent).toBe(COPY.rsvpWaitlisted);
    expect(byTestId("rsvp-result-body").textContent).toBe(COPY.rsvpWaitlistedBody);

    api.on("POST", /\/rsvps$/, () => ({ status: 200, body: { status: "waitlisted" } }));
    await fillRsvp(byTestId);
    expect(byTestId("rsvp-result-heading").textContent).toBe(COPY.rsvpWaitlisted);
    expect(byTestId("rsvp-result-body").textContent).toBe(COPY.rsvpDuplicateBody);
    expect(document.querySelector('[data-testid="rsvp-cancel-link"]')).toBeNull();
  });

  it("places an API email error on the email input and keeps the values", async () => {
    const { api, byTestId } = await startApp(MARKET);
    api.on("POST", /\/rsvps$/, () => ({
      status: 400,
      body: errorBody("VALIDATION_ERROR", "email"),
    }));
    await fillRsvp(byTestId, "resident@example.invalid");
    const email = byTestId<HTMLInputElement>("rsvp-email");
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe("rsvp-email-error");
    expect(byTestId("rsvp-email-error").textContent).toBe(COPY.invalidEmail);
    expect(email.value).toBe("resident@example.invalid");
    expect(byTestId<HTMLInputElement>("rsvp-display-name").value).toBe("Synthetic Resident Two");
  });

  it("blocks invalid input on the client and disables submit while pending", async () => {
    const api = new FakeApi();
    let release: () => void = () => undefined;
    api.on("POST", /\/rsvps$/, async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return {
        status: 201,
        body: { status: "confirmed", cancelToken: "synthetic-cancel-token-0002" },
      };
    });
    const { byTestId } = await startApp(MARKET, { api });
    await fillRsvp(byTestId, "not-an-email");
    expect(byTestId("rsvp-email-error").textContent).toBe(COPY.invalidEmail);
    expect(api.requestsTo("POST", /\/rsvps$/)).toHaveLength(0);

    await fillRsvp(byTestId);
    expect(byTestId<HTMLButtonElement>("rsvp-submit").disabled).toBe(true);
    release();
    await flush();
    expect(byTestId<HTMLButtonElement>("rsvp-submit").disabled).toBe(false);
  });
});
