import { describe, expect, it } from "vitest";
import { validateEventInput } from "../../../src/event-api/events/validation.js";
import { ApiError } from "../../../src/event-api/http/errors.js";
import { requireEventId } from "../../../src/event-api/http/fields.js";
import { validateCancelInput, validateRsvpInput } from "../../../src/event-api/rsvp/validation.js";
import { createSeedFixtures } from "../../../src/seed/fixtures.js";

const NOW = new Date("2030-01-15T12:00:00.000Z");

function validEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "  Park Cleanup  ",
    description: "Synthetic cleanup event.",
    startsAt: "2030-02-01T10:00:00.000Z",
    location: "Riverside Park",
    category: "Volunteering",
    capacity: 10,
    ...overrides,
  };
}

function captureError(action: () => unknown): ApiError {
  try {
    action();
  } catch (error) {
    if (error instanceof ApiError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an ApiError.");
}

describe("event validation (FR4)", () => {
  it("accepts a valid create payload and trims strings", () => {
    expect(validateEventInput(validEvent(), "create", NOW)).toEqual({
      title: "Park Cleanup",
      description: "Synthetic cleanup event.",
      startsAt: "2030-02-01T10:00:00.000Z",
      location: "Riverside Park",
      category: "Volunteering",
      capacity: 10,
    });
  });

  it.each(["title", "description", "startsAt", "location", "category", "capacity"])(
    "names the missing or blank field %s",
    (field) => {
      const missing = captureError(() =>
        validateEventInput(validEvent({ [field]: undefined }), "create", NOW),
      );
      expect(missing.toBody()).toMatchObject({ code: "VALIDATION_ERROR", field });
      expect(missing.statusCode).toBe(400);
      const blank = captureError(() =>
        validateEventInput(validEvent({ [field]: "   " }), "create", NOW),
      );
      expect(blank.field).toBe(field);
    },
  );

  it.each([0, 1.5, "3", -2])("rejects capacity %s", (capacity) => {
    const error = captureError(() => validateEventInput(validEvent({ capacity }), "create", NOW));
    expect(error.toBody()).toEqual({
      code: "VALIDATION_ERROR",
      message: "capacity must be an integer greater than zero.",
      field: "capacity",
    });
  });

  it("rejects a past or present start time on create with EVENT_START_TIME_INVALID", () => {
    for (const startsAt of ["2030-01-15T12:00:00.000Z", "2029-12-31T00:00:00.000Z"]) {
      const error = captureError(() => validateEventInput(validEvent({ startsAt }), "create", NOW));
      expect(error.toBody()).toMatchObject({ code: "EVENT_START_TIME_INVALID", field: "startsAt" });
      expect(error.statusCode).toBe(400);
    }
  });

  it("accepts a past start time on update and canonicalizes non-canonical dates", () => {
    const updated = validateEventInput(
      validEvent({ startsAt: "2029-12-31T09:00:00+02:00" }),
      "update",
      NOW,
    );
    expect(updated.startsAt).toBe("2029-12-31T07:00:00.000Z");
    const error = captureError(() =>
      validateEventInput(validEvent({ startsAt: "next tuesday" }), "update", NOW),
    );
    expect(error.field).toBe("startsAt");
  });

  it("rejects over-length fields, unknown fields, and non-object bodies", () => {
    expect(
      captureError(() => validateEventInput(validEvent({ title: "x".repeat(201) }), "create", NOW))
        .field,
    ).toBe("title");
    expect(
      captureError(() => validateEventInput(validEvent({ owner: "someone" }), "create", NOW)).field,
    ).toBe("owner");
    expect(captureError(() => validateEventInput([], "create", NOW)).field).toBe("body");
    expect(captureError(() => validateEventInput(null, "create", NOW)).field).toBe("body");
  });

  it("applies the same non-date rules to the C1 seed fixtures (AC2.2.8)", () => {
    const fixtures = createSeedFixtures({
      organizerSubject: "11111111-1111-4111-8111-111111111111",
      clock: () => NOW,
    });
    for (const fixture of fixtures.filter((item) => item.sk === "META")) {
      const payload = Object.fromEntries(
        ["title", "description", "startsAt", "location", "category", "capacity"].map((key) => [
          key,
          fixture[key],
        ]),
      );
      expect(() => validateEventInput(payload, "update", NOW)).not.toThrow();
    }
  });
});

describe("RSVP validation (FR5.2)", () => {
  it("lower-cases the email identity and trims the display name", () => {
    expect(
      validateRsvpInput({ displayName: " Resident Two ", email: " Resident.Two@Example.COM " }),
    ).toEqual({ displayName: "Resident Two", normalizedEmail: "resident.two@example.com" });
  });

  it("rejects invalid email, missing display name, and over-length values", () => {
    expect(captureError(() => validateRsvpInput({ displayName: "A", email: "nope" })).field).toBe(
      "email",
    );
    expect(captureError(() => validateRsvpInput({ email: "a@example.com" })).field).toBe(
      "displayName",
    );
    expect(
      captureError(() =>
        validateRsvpInput({ displayName: "x".repeat(101), email: "a@example.com" }),
      ).field,
    ).toBe("displayName");
    expect(
      captureError(() =>
        validateRsvpInput({ displayName: "A", email: `${"x".repeat(250)}@example.com` }),
      ).field,
    ).toBe("email");
  });

  it("requires the cancelToken field but leaves token format checks to the service", () => {
    expect(validateCancelInput({ cancelToken: "anything" })).toBe("anything");
    expect(captureError(() => validateCancelInput({})).toBody()).toMatchObject({
      code: "VALIDATION_ERROR",
      field: "cancelToken",
    });
  });

  it("reports impossible event identifiers as NOT_FOUND", () => {
    expect(requireEventId("seed-event-community-market")).toBe("seed-event-community-market");
    for (const id of [undefined, "", "EVENT#x", "a/b", "x".repeat(129)]) {
      expect(captureError(() => requireEventId(id)).toBody()).toMatchObject({
        code: "NOT_FOUND",
        field: "id",
      });
    }
  });
});
