// Shared shell: header with role-aware navigation and a mobile menu, the main
// landmark, a polite live region, and the footer.
import type { SessionInfo } from "../auth/session.js";
import { COPY } from "../copy.js";
import { announceIn, el, link, replaceChildren } from "../dom.js";

export interface Layout {
  main: HTMLElement;
  update(session: SessionInfo | null): void;
  announce(message: string): void;
}

export interface LayoutHandlers {
  onSignOut(): void;
}

export function createLayout(root: HTMLElement, handlers: LayoutHandlers): Layout {
  const navList = el("ul", { className: "nav-list" });
  const nav = el(
    "nav",
    { attrs: { id: "site-nav", "aria-label": "Main" }, className: "site-nav" },
    [navList],
  );
  const menuButton = el("button", {
    text: "Menu",
    testid: "nav-menu-button",
    className: "menu-button",
    attrs: { type: "button", "aria-expanded": "false", "aria-controls": "site-nav" },
  });
  menuButton.addEventListener("click", () => {
    const expanded = menuButton.getAttribute("aria-expanded") === "true";
    menuButton.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open", !expanded);
  });
  const header = el("header", { className: "site-header" }, [
    el("div", { className: "header-inner" }, [
      link("/events", COPY.siteName, "site-home-link", "site-name"),
      menuButton,
      nav,
    ]),
  ]);
  const main = el("main", { attrs: { id: "main" }, className: "site-main" });
  const liveRegion = el("div", {
    testid: "live-region",
    className: "visually-hidden",
    attrs: { role: "status", "aria-live": "polite" },
  });
  const footer = el("footer", { className: "site-footer" }, [el("p", { text: COPY.footer })]);
  replaceChildren(root, [header, main, liveRegion, footer]);

  return {
    main,
    update: (session) => {
      replaceChildren(navList, navItems(session, handlers));
      menuButton.setAttribute("aria-expanded", "false");
      nav.classList.remove("open");
    },
    announce: (message) => announceIn(liveRegion, message),
  };
}

function navItems(session: SessionInfo | null, handlers: LayoutHandlers): HTMLLIElement[] {
  const items = [link("/events", "Events", "nav-events")];
  if (session?.role === "organizer") {
    items.push(link("/organizer/events", "Your events", "nav-organizer-events"));
  }
  if (session?.role === "admin") {
    items.push(link("/admin/events", "Manage all events", "nav-admin-events"));
    items.push(link("/admin/stats", "Admin statistics", "nav-admin-stats"));
  }
  const entries: HTMLElement[] = [...items];
  if (session) {
    entries.push(
      el("button", {
        text: "Sign out",
        testid: "nav-sign-out",
        className: "link-button",
        attrs: { type: "button" },
        on: { click: () => handlers.onSignOut() },
      }),
    );
  } else {
    entries.push(link("/sign-in", "Sign in", "nav-sign-in"));
  }
  return entries.map((entry) => el("li", {}, [entry]));
}
