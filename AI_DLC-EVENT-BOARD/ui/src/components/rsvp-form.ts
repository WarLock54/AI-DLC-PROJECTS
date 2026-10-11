// RSVPForm (D11/D12): public RSVP with display name and email. A 201 shows the
// status and the one-time cancellation link (token only in the URL fragment);
// a 200 shows the existing status without a new link.
import { ApiError } from "../api/client.js";
import type { RsvpCreatedResponse, RsvpStatus } from "../api/types.js";
import { COPY, messageForError } from "../copy.js";
import { el, focusElement, link, replaceChildren, setFieldError } from "../dom.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface RsvpFormOptions {
  eventId: string;
  createRsvp(
    eventId: string,
    body: { displayName: string; email: string },
  ): Promise<{ status: number; data: { status: RsvpStatus; cancelToken?: string } }>;
  announce(message: string): void;
}

export function cancellationHref(eventId: string, status: RsvpStatus, token: string): string {
  const query = new URLSearchParams({ event: eventId, joined: status });
  return `/rsvp/cancel?${query.toString()}#token=${encodeURIComponent(token)}`;
}

function field(
  id: string,
  label: string,
  input: HTMLInputElement,
): { wrapper: HTMLDivElement; error: HTMLParagraphElement } {
  const error = el("p", {
    className: "field-error",
    testid: `${id}-error`,
    attrs: { id: `${id}-error` },
  });
  error.hidden = true;
  const wrapper = el("div", { className: "field" }, [
    el("label", { text: label, attrs: { for: id } }),
    input,
    error,
  ]);
  return { wrapper, error };
}

export function createRsvpForm(options: RsvpFormOptions): HTMLElement {
  const nameInput = el("input", {
    testid: "rsvp-display-name",
    attrs: { id: "rsvp-display-name", name: "displayName", autocomplete: "name", required: "" },
  });
  const emailInput = el("input", {
    testid: "rsvp-email",
    attrs: { id: "rsvp-email", name: "email", type: "email", autocomplete: "email", required: "" },
  });
  const name = field("rsvp-display-name", "Display name", nameInput);
  const email = field("rsvp-email", "Email", emailInput);
  const submit = el("button", {
    text: COPY.joinEvent,
    testid: "rsvp-submit",
    attrs: { type: "submit" },
  });
  const result = el("div", {
    testid: "rsvp-result",
    className: "result",
    attrs: { "aria-live": "polite" },
  });
  const form = el("form", { testid: "rsvp-form", attrs: { novalidate: "" } }, [
    name.wrapper,
    email.wrapper,
    submit,
  ]);

  const validate = (): boolean => {
    const nameMessage = nameInput.value.trim() === "" ? COPY.requiredDisplayName : null;
    const emailMessage = EMAIL_PATTERN.test(emailInput.value.trim()) ? null : COPY.invalidEmail;
    setFieldError(nameInput, name.error, nameMessage);
    setFieldError(emailInput, email.error, emailMessage);
    if (nameMessage || emailMessage) {
      focusElement(nameMessage ? nameInput : emailInput);
      return false;
    }
    return true;
  };

  const showResult = (status: RsvpStatus, body: string, token?: string): void => {
    const heading = el("h3", {
      text: status === "confirmed" ? COPY.rsvpConfirmed : COPY.rsvpWaitlisted,
      testid: "rsvp-result-heading",
    });
    replaceChildren(result, [
      heading,
      el("p", { text: body, testid: "rsvp-result-body" }),
      token
        ? el("p", {}, [
            `${COPY.cancellationLinkIntro} `,
            link(
              cancellationHref(options.eventId, status, token),
              "Your cancellation link",
              "rsvp-cancel-link",
            ),
          ])
        : null,
    ]);
    options.announce(`${heading.textContent}. ${body}`);
    focusElement(heading);
  };

  const showFailure = (error: unknown): void => {
    if (error instanceof ApiError && error.field === "email") {
      setFieldError(emailInput, email.error, COPY.invalidEmail);
      focusElement(emailInput);
      return;
    }
    if (error instanceof ApiError && error.field === "displayName") {
      setFieldError(nameInput, name.error, COPY.requiredDisplayName);
      focusElement(nameInput);
      return;
    }
    const message = messageForError(error);
    replaceChildren(result, [
      el("p", { text: message, testid: "rsvp-error", attrs: { role: "alert" } }),
    ]);
    options.announce(message);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    submit.disabled = true;
    options.announce(COPY.joining);
    options
      .createRsvp(options.eventId, {
        displayName: nameInput.value.trim(),
        email: emailInput.value.trim(),
      })
      .then(({ status, data }) => {
        if (status === 201) {
          const created = data as RsvpCreatedResponse;
          const body =
            created.status === "confirmed" ? COPY.rsvpConfirmedBody : COPY.rsvpWaitlistedBody;
          showResult(created.status, body, created.cancelToken);
        } else {
          showResult(data.status, COPY.rsvpDuplicateBody);
        }
      })
      .catch(showFailure)
      .finally(() => {
        submit.disabled = false;
      });
  });

  return el("div", { className: "rsvp" }, [form, result]);
}
