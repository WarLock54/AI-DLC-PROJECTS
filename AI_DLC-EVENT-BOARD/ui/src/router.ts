// D6: History API router with role guards. Guards only shape navigation; the
// API remains the authorization boundary.
import { defaultRouteFor, PROTECTED_ROUTES } from "./auth/roles.js";
import type { SessionInfo } from "./auth/session.js";
import { focusElement } from "./dom.js";

export type RouteName =
  | "events"
  | "event-detail"
  | "rsvp-cancel"
  | "sign-in"
  | "organizer-events"
  | "admin-events"
  | "admin-stats"
  | "not-found";

export interface RouteMatch {
  name: RouteName;
  path: string;
  params: Record<string, string>;
}

export interface RouteView {
  match: RouteMatch;
  session: SessionInfo | null;
  url: URL;
}

const STATIC_ROUTES: Record<string, RouteName> = {
  "/events": "events",
  "/rsvp/cancel": "rsvp-cancel",
  "/sign-in": "sign-in",
  "/organizer/events": "organizer-events",
  "/admin/events": "admin-events",
  "/admin/stats": "admin-stats",
};

const EVENT_DETAIL = /^\/events\/([^/]+)$/;

export function matchRoute(pathname: string): RouteMatch | { redirect: string } {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/" || path === "") {
    return { redirect: "/events" };
  }
  const name = STATIC_ROUTES[path];
  if (name) {
    return { name, path, params: {} };
  }
  const detail = EVENT_DETAIL.exec(path);
  if (detail) {
    let id: string;
    try {
      id = decodeURIComponent(detail[1]);
    } catch {
      return { name: "not-found", path, params: {} };
    }
    return { name: "event-detail", path, params: { id } };
  }
  return { name: "not-found", path, params: {} };
}

export interface RouterOptions {
  win: Window;
  getSession: () => Promise<SessionInfo | null>;
  render: (view: RouteView) => Promise<void> | void;
}

export class Router {
  private readonly options: RouterOptions;

  constructor(options: RouterOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.options.win.addEventListener("popstate", this.onPopState);
    this.options.win.document.addEventListener("click", this.onClick);
    await this.resolve();
  }

  stop(): void {
    this.options.win.removeEventListener("popstate", this.onPopState);
    this.options.win.document.removeEventListener("click", this.onClick);
  }

  async navigate(target: string, options: { replace?: boolean } = {}): Promise<void> {
    const history = this.options.win.history;
    if (options.replace) {
      history.replaceState(null, "", target);
    } else {
      history.pushState(null, "", target);
    }
    await this.resolve();
  }

  async resolve(): Promise<void> {
    const url = new URL(this.options.win.location.href);
    const matched = matchRoute(url.pathname);
    if ("redirect" in matched) {
      await this.navigate(matched.redirect + url.search, { replace: true });
      return;
    }
    const allowedRoles = PROTECTED_ROUTES[matched.path];
    const session = await this.options.getSession();
    if (allowedRoles) {
      if (!session) {
        const returnTo = encodeURIComponent(url.pathname + url.search);
        await this.navigate(`/sign-in?returnTo=${returnTo}`, { replace: true });
        return;
      }
      if (!session.role || !allowedRoles.includes(session.role)) {
        await this.navigate(defaultRouteFor(session.role), { replace: true });
        return;
      }
    }
    await this.options.render({ match: matched, session, url });
    focusElement(this.options.win.document.querySelector<HTMLElement>("main h1"));
  }

  private readonly onPopState = (): void => {
    void this.resolve();
  };

  private readonly onClick = (event: Event): void => {
    const mouse = event as MouseEvent;
    if (
      mouse.defaultPrevented ||
      mouse.button !== 0 ||
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.altKey
    ) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest<HTMLAnchorElement>("a[data-link]");
    if (!anchor || anchor.target === "_blank") {
      return;
    }
    const destination = new URL(anchor.href, this.options.win.location.href);
    if (destination.origin !== this.options.win.location.origin) {
      return;
    }
    event.preventDefault();
    void this.navigate(destination.pathname + destination.search + destination.hash);
  };
}
