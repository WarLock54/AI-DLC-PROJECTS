import { COPY } from "../copy.js";
import { el, link, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

export function renderNotFound(ctx: PageContext): void {
  ctx.setTitle(COPY.notFoundTitle);
  replaceChildren(ctx.main, [
    el("h1", { text: COPY.notFoundTitle }),
    el("p", { text: "There is no page at this address." }),
    link("/events", "Browse community events", "not-found-events-link"),
  ]);
}
