// Composition root: wires the API client, session, layout, router, and pages.
import { ApiClient } from "./api/client.js";
import type { AuthService } from "./auth/session.js";
import { COPY } from "./copy.js";
import { el, replaceChildren } from "./dom.js";
import { renderAdminStats } from "./pages/admin-stats.js";
import type { PageContext } from "./pages/context.js";
import { renderEventDetail } from "./pages/event-detail.js";
import { renderEventManagement } from "./pages/event-management.js";
import { renderEventsList } from "./pages/events-list.js";
import { createLayout, type Layout } from "./pages/layout.js";
import { renderNotFound } from "./pages/not-found.js";
import { renderRsvpCancel } from "./pages/rsvp-cancel.js";
import { renderSignIn } from "./pages/sign-in.js";
import { Router, type RouteView } from "./router.js";

export interface AppDependencies {
  root: HTMLElement;
  win: Window;
  auth: AuthService;
  fetchImpl?: typeof fetch;
}

export interface App {
  router: Router;
  layout: Layout;
  api: ApiClient;
}

export function createApp(deps: AppDependencies): App {
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => deps.win.fetch(input, init));
  // The router is created below; these callbacks only run after start().
  const navigate = (path: string, options?: { replace?: boolean }): Promise<void> =>
    router.navigate(path, options);
  const api = new ApiClient({
    fetchImpl,
    getIdToken: async () => (await deps.auth.getSession())?.idToken ?? null,
    onUnauthorized: () => {
      deps.auth.signOut();
      const location = deps.win.location;
      const returnTo = encodeURIComponent(location.pathname + location.search);
      void navigate(`/sign-in?returnTo=${returnTo}`, { replace: true });
    },
  });
  const layout = createLayout(deps.root, {
    onSignOut: () => {
      deps.auth.signOut();
      void navigate("/events");
    },
  });
  const router: Router = new Router({
    win: deps.win,
    getSession: () => deps.auth.getSession(),
    render: (view): Promise<void> => renderView(view, { deps, api, layout, router, fetchImpl }),
  });
  return { router, layout, api };
}

interface RenderDependencies {
  deps: AppDependencies;
  api: ApiClient;
  layout: Layout;
  router: Router;
  fetchImpl: typeof fetch;
}

async function renderView(view: RouteView, render: RenderDependencies): Promise<void> {
  const { deps, api, layout, router } = render;
  layout.update(view.session);
  const ctx: PageContext = {
    main: layout.main,
    api,
    auth: deps.auth,
    session: view.session,
    params: view.match.params,
    url: view.url,
    fetchImpl: render.fetchImpl,
    announce: layout.announce,
    navigate: (path, options) => router.navigate(path, options),
    setTitle: (title) => {
      deps.win.document.title = `${title} · ${COPY.siteName}`;
    },
  };
  switch (view.match.name) {
    case "events":
      return renderEventsList(ctx);
    case "event-detail":
      return renderEventDetail(ctx);
    case "rsvp-cancel":
      return renderRsvpCancel(ctx);
    case "sign-in":
      return renderSignIn(ctx);
    case "organizer-events":
      return renderEventManagement(ctx, "organizer");
    case "admin-events":
      return renderEventManagement(ctx, "admin");
    case "admin-stats":
      return renderAdminStats(ctx);
    default:
      return renderNotFound(ctx);
  }
}

/** Full-page service error used when /config.json is missing or invalid (D5). */
export function renderServiceError(root: HTMLElement): void {
  replaceChildren(root, [
    el("main", { attrs: { id: "main" }, className: "site-main" }, [
      el("h1", { text: COPY.siteName }),
      el("p", { text: COPY.configError, testid: "service-error", attrs: { role: "alert" } }),
    ]),
  ]);
}
