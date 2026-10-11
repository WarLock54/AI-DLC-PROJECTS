import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionInfo } from "../../../ui/src/auth/session.js";
import { startApp } from "./support/app.js";
import { FakeApi, flush } from "./support/fake-api.js";
import { adminSession, organizerSession } from "./support/jwt.js";

const STYLES = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui", "styles.css"),
  "utf8",
);

const ROUTES: [string, SessionInfo | null][] = [
  ["/events", null],
  ["/events/seed-event-community-market", null],
  ["/events/unknown-event", null],
  [
    "/rsvp/cancel?event=seed-event-community-market&joined=confirmed#token=synthetic-cancel-token-0001",
    null,
  ],
  ["/sign-in", null],
  ["/organizer/events", organizerSession()],
  ["/admin/events", adminSession()],
  ["/admin/stats", adminSession()],
  ["/nowhere", null],
];

function navLabels(): string[] {
  return [...document.querySelectorAll("nav li")].map((item) => item.textContent ?? "");
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return (light + 0.05) / (dark + 0.05);
}

function cssVariables(): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(STYLES)?.[1] ?? "";
  return Object.fromEntries(
    [...root.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(([, name, value]) => [
      name,
      value,
    ]),
  );
}

describe("layout and accessibility (D16)", () => {
  it("renders the landmarks and exactly one h1 on every route", async () => {
    for (const [path, session] of ROUTES) {
      await startApp(path, { session });
      for (const landmark of ["header", "nav", "main", "footer"]) {
        expect({ path, landmark, found: document.querySelectorAll(landmark).length }).toEqual({
          path,
          landmark,
          found: 1,
        });
      }
      expect({ path, h1: document.querySelectorAll("h1").length }).toEqual({ path, h1: 1 });
      expect(document.querySelector('[data-testid="live-region"]')?.getAttribute("aria-live")).toBe(
        "polite",
      );
    }
  });

  it("shows navigation items for each role and signs out back to /events", async () => {
    await startApp("/events");
    expect(navLabels()).toEqual(["Events", "Sign in"]);
    await startApp("/events", { session: organizerSession() });
    expect(navLabels()).toEqual(["Events", "Your events", "Sign out"]);
    const admin = await startApp("/events", { session: adminSession() });
    expect(navLabels()).toEqual(["Events", "Manage all events", "Admin statistics", "Sign out"]);
    admin.byTestId("nav-sign-out").click();
    await flush();
    expect(admin.auth.signOut).toHaveBeenCalledTimes(1);
    expect(navLabels()).toEqual(["Events", "Sign in"]);
  });

  it("toggles aria-expanded on the mobile menu button", async () => {
    const { byTestId } = await startApp("/events");
    const button = byTestId("nav-menu-button");
    expect(button.getAttribute("aria-controls")).toBe("site-nav");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("site-nav")?.classList.contains("open")).toBe(true);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives every interactive element a data-testid", async () => {
    const checks: [string, SessionInfo | null, (byTestId: (id: string) => HTMLElement) => void][] =
      [
        ["/events", null, () => undefined],
        ["/events/seed-event-community-market", null, () => undefined],
        ["/sign-in", null, () => undefined],
        ["/admin/events", adminSession(), (byTestId) => byTestId("manage-create").click()],
        [
          "/rsvp/cancel?event=seed-event-community-market&joined=confirmed#token=synthetic-cancel-token-0001",
          null,
          (byTestId) => byTestId("cancel-rsvp-button").click(),
        ],
      ];
    for (const [path, session, act] of checks) {
      const harness = await startApp(path, { session, api: new FakeApi() });
      act(harness.byTestId);
      await flush();
      const missing = [...document.querySelectorAll("a, button, input, select, textarea, dialog")]
        .filter((element) => !element.hasAttribute("data-testid"))
        .map(
          (element) => `${path}: <${element.tagName.toLowerCase()}> ${element.textContent ?? ""}`,
        );
      expect(missing).toEqual([]);
    }
  });

  it("keeps text and background token pairs at 4.5:1 or better", () => {
    const tokens = cssVariables();
    const pairs: [string, string][] = [
      ["text", "bg"],
      ["text", "surface"],
      ["muted", "bg"],
      ["muted", "surface"],
      ["link", "bg"],
      ["link", "surface"],
      ["primary-text", "primary"],
      ["danger-text", "danger"],
      ["error", "bg"],
      ["success", "bg"],
    ];
    for (const [foreground, background] of pairs) {
      expect(tokens[foreground], foreground).toMatch(/^#/);
      expect(tokens[background], background).toMatch(/^#/);
      const ratio = contrast(tokens[foreground], tokens[background]);
      expect({ foreground, background, passes: ratio >= 4.5 }).toEqual({
        foreground,
        background,
        passes: true,
      });
    }
    // Focus outline against the page background meets the 3:1 non-text minimum.
    expect(contrast(tokens.focus, tokens.bg)).toBeGreaterThanOrEqual(3);
  });

  it("includes a prefers-reduced-motion guard and the 768/1024 px breakpoints", () => {
    expect(STYLES).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*transition-duration: 0\.01ms/,
    );
    expect(STYLES).toContain("@media (min-width: 768px)");
    expect(STYLES).toContain("@media (min-width: 1024px)");
    expect(STYLES).toContain("--control-min-height: 44px");
    expect(STYLES).toMatch(/outline: 2px solid var\(--color-focus\)/);
  });
});
