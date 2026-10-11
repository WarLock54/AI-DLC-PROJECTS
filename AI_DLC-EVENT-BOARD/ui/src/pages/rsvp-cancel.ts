// D12: /rsvp/cancel?event={id}&joined={status}#token={token}. The token stays in
// the fragment, so it is never sent to CloudFront or in a Referer header, and it
// is never shown or logged. Opening the page alone never cancels.
import type { RsvpStatus } from "../api/types.js";
import { createCancellationAction, invalidLinkMessage } from "../components/cancellation-action.js";
import { el, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

function readToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token && token.trim() !== "" ? token : null;
}

function readJoined(value: string | null): RsvpStatus | null {
  return value === "confirmed" || value === "waitlisted" ? value : null;
}

export async function renderRsvpCancel(ctx: PageContext): Promise<void> {
  ctx.setTitle("Cancel your RSVP");
  const eventId = ctx.url.searchParams.get("event");
  const joined = readJoined(ctx.url.searchParams.get("joined"));
  const token = readToken(ctx.url.hash);
  if (!eventId || !token) {
    replaceChildren(ctx.main, [
      el("h1", { text: "Cancel your RSVP" }),
      invalidLinkMessage(eventId),
    ]);
    return;
  }

  let title: string | null = null;
  try {
    title = (await ctx.api.getEvent(eventId)).title;
  } catch {
    // The event title is context only; cancellation still works without it.
    title = null;
  }
  const statusText =
    joined === "confirmed"
      ? "Your RSVP status when you joined: Confirmed."
      : joined === "waitlisted"
        ? "Your RSVP status when you joined: Waitlisted."
        : null;
  replaceChildren(ctx.main, [
    el("h1", { text: title ? `Cancel your RSVP for ${title}` : "Cancel your RSVP" }),
    statusText ? el("p", { text: statusText, testid: "cancel-joined-status" }) : null,
    createCancellationAction({
      eventId,
      joined,
      token,
      cancelRsvp: (value) => ctx.api.cancelRsvp(value),
      announce: ctx.announce,
    }),
  ]);
}
