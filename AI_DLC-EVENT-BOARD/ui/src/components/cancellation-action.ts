// CancellationAction (D12): explicit, confirmed, one-time RSVP cancellation. The
// token is only ever sent in the JSON request body.
import { ApiError } from "../api/client.js";
import type { RsvpStatus } from "../api/types.js";
import { COPY, messageForError } from "../copy.js";
import { el, focusElement, link, replaceChildren } from "../dom.js";
import { confirmDialog } from "./confirm-dialog.js";

export interface CancellationOptions {
  eventId: string;
  joined: RsvpStatus | null;
  token: string;
  cancelRsvp(token: string): Promise<void>;
  announce(message: string): void;
}

export function invalidLinkMessage(eventId: string | null): HTMLElement {
  return el("div", { testid: "cancel-invalid", attrs: { role: "alert" } }, [
    el("p", { text: COPY.cancelInvalid }),
    el("ul", {}, [
      eventId
        ? el("li", {}, [
            link(
              `/events/${encodeURIComponent(eventId)}`,
              "Back to the event",
              "cancel-event-link",
            ),
          ])
        : null,
      el("li", {}, [link("/events", "Browse all events", "cancel-events-link")]),
    ]),
  ]);
}

export function createCancellationAction(options: CancellationOptions): HTMLElement {
  const result = el("div", { testid: "cancel-result" });
  const button = el("button", {
    text: "Cancel RSVP",
    testid: "cancel-rsvp-button",
    className: "danger",
    attrs: { type: "button" },
  });

  const cancel = async (): Promise<void> => {
    button.disabled = true;
    options.announce("Cancelling your RSVP");
    try {
      await options.cancelRsvp(options.token);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        button.remove();
        replaceChildren(result, [invalidLinkMessage(options.eventId)]);
        options.announce(COPY.cancelInvalid);
        return;
      }
      button.disabled = false;
      const message = messageForError(error);
      replaceChildren(result, [
        el("p", { text: message, testid: "cancel-error", attrs: { role: "alert" } }),
      ]);
      options.announce(message);
      return;
    }
    button.remove();
    const message =
      options.joined === "waitlisted" ? COPY.cancelWaitlistedDone : COPY.cancelConfirmedDone;
    const heading = el("h2", { text: "RSVP cancelled", testid: "cancel-done-heading" });
    replaceChildren(result, [heading, el("p", { text: message, testid: "cancel-done" })]);
    options.announce(`RSVP cancelled. ${message}`);
    focusElement(heading);
  };

  button.addEventListener("click", () => {
    void confirmDialog({
      title: "Cancel this RSVP?",
      body: "Your RSVP will be cancelled and this link will stop working. This cannot be undone.",
      confirmLabel: "Yes, cancel RSVP",
      testid: "cancel-dialog",
      trigger: button,
    }).then((confirmed) => (confirmed ? cancel() : undefined));
  });

  return el("div", { className: "cancellation" }, [button, result]);
}
