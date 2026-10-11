// D11: stable event detail at /events/{id}, copy link, and RSVP.
import { ApiError } from "../api/client.js";
import type { EventDetail } from "../api/types.js";
import { bannerImage, detailPath, metadataList } from "../components/event-card.js";
import { createRsvpForm } from "../components/rsvp-form.js";
import { COPY, messageForError } from "../copy.js";
import { el, link, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

export async function renderEventDetail(ctx: PageContext): Promise<void> {
  const eventId = ctx.params.id;
  let event: EventDetail;
  try {
    event = await ctx.api.getEvent(eventId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      renderUnavailable(ctx);
    } else {
      renderLoadError(ctx, error);
    }
    return;
  }
  ctx.setTitle(event.title);
  replaceChildren(ctx.main, [
    link("/events", `← ${COPY.backToEvents}`, "event-back-link"),
    el("article", { className: "event-detail", testid: "event-detail" }, [
      el("h1", { text: event.title }),
      copyLinkControl(ctx, event.eventId),
      bannerImage(event.bannerReference, "event-detail-banner"),
      metadataList(event),
      el("h2", { text: "About this event" }),
      el("p", { text: event.description, testid: "event-description" }),
    ]),
    el("section", { attrs: { "aria-labelledby": "join-heading" } }, [
      el("h2", { text: "Join this event", attrs: { id: "join-heading" } }),
      createRsvpForm({
        eventId: event.eventId,
        createRsvp: (id, body) => ctx.api.createRsvp(id, body),
        announce: ctx.announce,
      }),
    ]),
  ]);
}

function copyLinkControl(ctx: PageContext, eventId: string): HTMLElement {
  const url = `${ctx.url.origin}${detailPath(eventId)}`;
  const status = el("p", { testid: "event-copy-status", attrs: { role: "status" } });
  const fallback = el("div", { testid: "event-copy-fallback-group", className: "field" });
  fallback.hidden = true;
  const button = el("button", {
    text: "Copy event link",
    testid: "event-copy-link",
    className: "secondary",
    attrs: { type: "button" },
  });
  button.addEventListener("click", () => {
    const write = navigator.clipboard?.writeText(url) ?? Promise.reject(new Error("No clipboard"));
    write
      .then(() => {
        status.textContent = COPY.copyLinkDone;
        ctx.announce(COPY.copyLinkDone);
      })
      .catch(() => {
        const input = el("input", {
          testid: "event-copy-fallback",
          attrs: { id: "event-link-field", readonly: "", value: url },
        });
        replaceChildren(fallback, [
          el("label", { text: COPY.copyLinkManual, attrs: { for: "event-link-field" } }),
          input,
        ]);
        fallback.hidden = false;
        input.select();
        status.textContent = "";
        ctx.announce(COPY.copyLinkManual);
      });
  });
  return el("div", { className: "copy-link" }, [button, status, fallback]);
}

function renderUnavailable(ctx: PageContext): void {
  ctx.setTitle(COPY.eventUnavailable);
  replaceChildren(ctx.main, [
    el("h1", { text: COPY.eventUnavailable }),
    el("p", { text: COPY.eventUnavailableBody, testid: "event-unavailable" }),
    link("/events", COPY.backToEvents, "event-unavailable-back"),
  ]);
}

function renderLoadError(ctx: PageContext, error: unknown): void {
  ctx.setTitle("Event details");
  replaceChildren(ctx.main, [
    el("h1", { text: "Event details" }),
    el("p", { text: messageForError(error), testid: "event-error", attrs: { role: "alert" } }),
    el("button", {
      text: COPY.retry,
      testid: "event-retry",
      attrs: { type: "button" },
      on: { click: () => void renderEventDetail(ctx) },
    }),
    link("/events", COPY.backToEvents, "event-error-back"),
  ]);
}
