import { describe, expect, it } from "vitest";
import { COPY, ERROR_COPY } from "../../../ui/src/copy.js";
import { setValue, startApp, submit, type Harness } from "./support/app.js";
import { errorBody, flush } from "./support/fake-api.js";
import { adminSession, ORGANIZER_SUB, organizerSession } from "./support/jwt.js";

const FUTURE = "2099-06-01T10:30";

function fillForm(harness: Harness, overrides: Partial<Record<string, string>> = {}): void {
  const values: Record<string, string> = {
    title: "Synthetic Book Swap",
    description: "Bring a book, take a book.",
    startsat: FUTURE,
    location: "Library Hall",
    category: "Community",
    capacity: "25",
    ...overrides,
  };
  for (const [field, value] of Object.entries(values)) {
    setValue(harness.byTestId<HTMLInputElement>(`event-form-${field}`), value);
  }
}

function tableHeaders(): string[] {
  return [...document.querySelectorAll('[data-testid="manage-table"] thead th')].map(
    (cell) => cell.textContent ?? "",
  );
}

describe("organizer and admin event management (D13, US2.2, US3.1)", () => {
  it("organizer mode lists own events without an Owner column", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    expect(harness.api.requestsTo("GET", "/api/organizer/events")).toHaveLength(1);
    expect(document.querySelector("main h1")?.textContent).toBe("Your events");
    expect(tableHeaders()).not.toContain("Owner");
    expect(harness.allByTestId("manage-row")).toHaveLength(3);
  });

  it("admin mode lists all events with an Owner column and a status filter", async () => {
    const harness = await startApp("/admin/events", { session: adminSession() });
    expect(
      harness.api.requestsTo("GET", "/api/admin/events")[0].url.searchParams.get("status"),
    ).toBe("active");
    expect(tableHeaders()).toContain("Owner");
    expect(harness.allByTestId("manage-owner").map((cell) => cell.textContent)).toContain(
      ORGANIZER_SUB,
    );
    harness.api.events[0].lifecycleStatus = "archived";
    setValue(harness.byTestId<HTMLSelectElement>("manage-status-filter"), "archived");
    harness.byTestId("manage-status-apply").click();
    await flush();
    expect(
      harness.api.requestsTo("GET", "/api/admin/events").at(-1)?.url.searchParams.get("status"),
    ).toBe("archived");
    expect(harness.allByTestId("manage-row")).toHaveLength(1);
  });

  it("creates an event with an ISO startsAt and announces success", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    harness.byTestId("manage-create").click();
    fillForm(harness);
    submit(harness.byTestId<HTMLFormElement>("event-form"));
    await flush();
    const [request] = harness.api.requestsTo("POST", "/api/events");
    expect(request.body).toMatchObject({
      title: "Synthetic Book Swap",
      capacity: 25,
      startsAt: new Date(FUTURE).toISOString(),
    });
    expect(harness.byTestId("event-form-status").textContent).toBe(
      "Event created: Synthetic Book Swap",
    );
    expect(harness.allByTestId("manage-row")).toHaveLength(4);
    // The banner uploader is offered right after the create.
    expect(harness.byTestId("banner-uploader").getAttribute("data-state")).toBe("empty");
  });

  it("blocks capacity 0 and an empty title on the client", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    harness.byTestId("manage-create").click();
    fillForm(harness, { title: "  ", capacity: "0" });
    submit(harness.byTestId<HTMLFormElement>("event-form"));
    await flush();
    expect(harness.api.requestsTo("POST", "/api/events")).toHaveLength(0);
    expect(harness.byTestId("event-form-title-error").textContent).toBe("Enter a title.");
    expect(harness.byTestId("event-form-capacity-error").textContent).toBe(
      "Enter a whole number of places, 1 or more.",
    );
    expect(harness.byTestId("event-form-capacity").getAttribute("aria-describedby")).toBe(
      "event-capacity-error",
    );
  });

  it("puts CAPACITY_CONFLICT on the capacity field and keeps the values", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    harness.api.on("PUT", /^\/api\/events\/[^/]+$/, () => ({
      status: 409,
      body: errorBody("CAPACITY_CONFLICT"),
    }));
    harness.allByTestId("manage-edit")[0].click();
    setValue(harness.byTestId<HTMLInputElement>("event-form-capacity"), "1");
    setValue(harness.byTestId<HTMLInputElement>("event-form-title"), "Edited Title");
    submit(harness.byTestId<HTMLFormElement>("event-form"));
    await flush();
    expect(harness.byTestId("event-form-capacity-error").textContent).toBe(
      ERROR_COPY.CAPACITY_CONFLICT,
    );
    expect(harness.byTestId<HTMLInputElement>("event-form-capacity").value).toBe("1");
    expect(harness.byTestId<HTMLInputElement>("event-form-title").value).toBe("Edited Title");
  });

  it("names the event in the delete dialog; Cancel restores focus and Confirm removes the row", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    const trigger = harness.allByTestId("manage-delete")[0];
    trigger.click();
    await flush();
    expect(harness.byTestId("delete-dialog").textContent).toContain("Delete Community Market?");
    harness.byTestId("delete-dialog-cancel").click();
    await flush();
    expect(document.activeElement).toBe(trigger);
    expect(harness.api.requestsTo("DELETE", /^\/api\/events\//)).toHaveLength(0);

    harness.allByTestId("manage-delete")[0].click();
    await flush();
    harness.byTestId("delete-dialog-confirm").click();
    await flush();
    expect(
      harness.api.requestsTo("DELETE", "/api/events/seed-event-community-market"),
    ).toHaveLength(1);
    expect(harness.allByTestId("manage-row")).toHaveLength(2);
    expect(harness.byTestId("manage-list-status").textContent).toBe(
      "Event deleted: Community Market",
    );
  });

  it("shows the permission message without data on 403", async () => {
    const harness = await startApp("/organizer/events", { session: organizerSession() });
    harness.api.on("GET", /^\/api\/organizer\/events$/, () => ({
      status: 403,
      body: errorBody("FORBIDDEN"),
    }));
    await harness.go("/organizer/events");
    expect(harness.byTestId("manage-forbidden").textContent).toBe(COPY.permissionDenied);
    expect(harness.allByTestId("manage-row")).toHaveLength(0);
  });

  it("clears the session and redirects to sign-in on 401", async () => {
    const harness = await startApp("/admin/events", { session: adminSession() });
    harness.api.on("GET", /^\/api\/admin\/events$/, () => ({
      status: 401,
      body: { message: "Unauthorized" },
    }));
    await harness.go("/admin/events?status=active");
    expect(harness.auth.signOut).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/sign-in");
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(
      "/admin/events?status=active",
    );
  });
});
