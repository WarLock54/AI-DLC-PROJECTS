import { describe, expect, it } from "vitest";
import { COPY } from "../../../ui/src/copy.js";
import { startApp } from "./support/app.js";
import { errorBody, flush } from "./support/fake-api.js";

const TOKEN = "synthetic-cancel-token-0001";
const LINK = `/rsvp/cancel?event=seed-event-community-market&joined=confirmed#token=${TOKEN}`;

function pressEscape(target: Element): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

describe("RSVP cancellation link (D12, US1.5, US1.6)", () => {
  it("never cancels on page open and keeps the token out of visible text", async () => {
    const { api, byTestId } = await startApp(LINK);
    expect(api.requestsTo("POST", "/api/rsvps/cancel")).toHaveLength(0);
    expect(document.querySelector("main h1")?.textContent).toBe(
      "Cancel your RSVP for Community Market",
    );
    expect(byTestId("cancel-joined-status").textContent).toContain("Confirmed");
    expect(document.body.textContent).not.toContain(TOKEN);
    // The token never travels in a query string or path.
    expect(api.requests.every((request) => !request.url.href.includes(TOKEN))).toBe(true);
  });

  it("opens a confirmation dialog; Escape closes it and returns focus to the trigger", async () => {
    const { api, byTestId } = await startApp(LINK);
    const trigger = byTestId("cancel-rsvp-button");
    trigger.click();
    await flush();
    const dialog = byTestId<HTMLDialogElement>("cancel-dialog");
    expect(dialog.open).toBe(true);
    pressEscape(dialog);
    await flush();
    expect(document.querySelector('[data-testid="cancel-dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(api.requestsTo("POST", "/api/rsvps/cancel")).toHaveLength(0);
  });

  it("sends the token only in the JSON body on confirm and shows the confirmed copy", async () => {
    const { api, byTestId } = await startApp(LINK);
    byTestId("cancel-rsvp-button").click();
    await flush();
    byTestId("cancel-dialog-confirm").click();
    await flush();
    const [request] = api.requestsTo("POST", "/api/rsvps/cancel");
    expect(request.body).toEqual({ cancelToken: TOKEN });
    expect(request.url.search).toBe("");
    expect(byTestId("cancel-done").textContent).toBe(COPY.cancelConfirmedDone);
    expect(document.activeElement).toBe(byTestId("cancel-done-heading"));
  });

  it("shows the waitlisted copy for a waitlisted RSVP", async () => {
    const { byTestId } = await startApp(LINK.replace("joined=confirmed", "joined=waitlisted"));
    byTestId("cancel-rsvp-button").click();
    await flush();
    byTestId("cancel-dialog-confirm").click();
    await flush();
    expect(byTestId("cancel-done").textContent).toBe(COPY.cancelWaitlistedDone);
  });

  it("shows the invalid/used message for 404 and 409 responses", async () => {
    for (const [status, code] of [
      [404, "NOT_FOUND"],
      [409, "CANCEL_TOKEN_CONSUMED"],
    ] as const) {
      const { api, byTestId } = await startApp(LINK);
      api.on("POST", /^\/api\/rsvps\/cancel$/, () => ({ status, body: errorBody(code) }));
      byTestId("cancel-rsvp-button").click();
      await flush();
      byTestId("cancel-dialog-confirm").click();
      await flush();
      expect(byTestId("cancel-invalid").textContent).toContain(COPY.cancelInvalid);
      expect(byTestId("cancel-event-link").getAttribute("href")).toBe(
        "/events/seed-event-community-market",
      );
      expect(byTestId("cancel-events-link").getAttribute("href")).toBe("/events");
    }
  });

  it("shows the same message without any API call when the fragment token is missing", async () => {
    const { api, byTestId } = await startApp(
      "/rsvp/cancel?event=seed-event-community-market&joined=confirmed",
    );
    expect(byTestId("cancel-invalid").textContent).toContain(COPY.cancelInvalid);
    expect(api.requests).toHaveLength(0);
    expect(document.querySelector('[data-testid="cancel-rsvp-button"]')).toBeNull();
  });

  it("still allows cancellation when the event title cannot be loaded", async () => {
    const { api, byTestId } = await startApp(
      LINK.replace("seed-event-community-market", "unknown-event"),
    );
    expect(document.querySelector("main h1")?.textContent).toBe("Cancel your RSVP");
    api.on("POST", /^\/api\/rsvps\/cancel$/, () => "network-error");
    byTestId("cancel-rsvp-button").click();
    await flush();
    byTestId("cancel-dialog-confirm").click();
    await flush();
    expect(byTestId("cancel-error").textContent).toBe(COPY.networkError);
    expect(byTestId<HTMLButtonElement>("cancel-rsvp-button").disabled).toBe(false);
  });
});
