import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../../ui/src/auth/session.js";
import { matchRoute, Router, type RouteView } from "../../../ui/src/router.js";
import { flush } from "./support/fake-api.js";
import { organizerSession } from "./support/jwt.js";

let router: Router | undefined;

function setup(session: SessionInfo | null = null) {
  const views: RouteView[] = [];
  router = new Router({
    win: window,
    getSession: async () => session,
    render: (view) => {
      views.push(view);
      document.body.replaceChildren();
      const main = document.createElement("main");
      const heading = document.createElement("h1");
      heading.textContent = view.match.name;
      main.appendChild(heading);
      document.body.appendChild(main);
    },
  });
  return { router, views };
}

function go(path: string): void {
  window.history.replaceState(null, "", path);
}

describe("client-side router (D6)", () => {
  beforeEach(() => go("/"));

  afterEach(() => {
    router?.stop();
    document.body.replaceChildren();
  });

  it("redirects / to /events", async () => {
    const { router: instance, views } = setup();
    await instance.resolve();
    expect(window.location.pathname).toBe("/events");
    expect(views.at(-1)?.match.name).toBe("events");
  });

  it("resolves a deep link to an event detail with its id", async () => {
    expect(matchRoute("/events/abc")).toEqual({
      name: "event-detail",
      path: "/events/abc",
      params: { id: "abc" },
    });
    const { router: instance, views } = setup();
    go("/events/abc");
    await instance.resolve();
    expect(views.at(-1)?.match.params).toEqual({ id: "abc" });
  });

  it("resolves unknown paths to the not-found route", () => {
    expect(matchRoute("/nowhere")).toMatchObject({ name: "not-found" });
    expect(matchRoute("/events/a/b")).toMatchObject({ name: "not-found" });
    expect(matchRoute("/events/%E0%A4%A")).toMatchObject({ name: "not-found" });
    expect(matchRoute("/admin/stats/")).toMatchObject({ name: "admin-stats" });
  });

  it("sends a guarded route without a session to sign-in with returnTo", async () => {
    const { router: instance, views } = setup(null);
    go("/admin/events?status=archived");
    await instance.resolve();
    expect(window.location.pathname).toBe("/sign-in");
    expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(
      "/admin/events?status=archived",
    );
    expect(views.map((view) => view.match.name)).toEqual(["sign-in"]);
  });

  it("keeps organizers out of admin routes", async () => {
    const { router: instance, views } = setup(organizerSession());
    go("/admin/stats");
    await instance.resolve();
    expect(window.location.pathname).toBe("/organizer/events");
    expect(views.map((view) => view.match.name)).toEqual(["organizer-events"]);
  });

  it("intercepts data-link clicks but leaves external links alone", async () => {
    const { router: instance, views } = setup();
    go("/events");
    await instance.start();
    const internal = document.createElement("a");
    internal.href = "/events/seed-event-community-market";
    internal.setAttribute("data-link", "");
    const external = document.createElement("a");
    external.href = "https://other.example/events";
    external.setAttribute("data-link", "");
    document.body.append(internal, external);

    const internalClick = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    internal.dispatchEvent(internalClick);
    await flush();
    expect(internalClick.defaultPrevented).toBe(true);
    expect(views.at(-1)?.match.params.id).toBe("seed-event-community-market");

    // The first navigation re-rendered the body, so re-attach the external link.
    document.body.append(external);
    // The window listener runs after the router's document listener. It records
    // whether the router prevented the default, then stops the test browser
    // from actually navigating away.
    let preventedByRouter: boolean | undefined;
    const stopNavigation = (event: Event): void => {
      preventedByRouter = event.defaultPrevented;
      event.preventDefault();
    };
    window.addEventListener("click", stopNavigation);
    const pushState = vi.spyOn(window.history, "pushState");
    external.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    window.removeEventListener("click", stopNavigation);
    expect(preventedByRouter).toBe(false);
    expect(pushState).not.toHaveBeenCalled();
  });

  it("moves focus to the page h1 after navigation", async () => {
    const { router: instance } = setup();
    await instance.navigate("/events");
    const heading = document.querySelector("main h1");
    expect(document.activeElement).toBe(heading);
    expect(heading?.getAttribute("tabindex")).toBe("-1");
  });
});
