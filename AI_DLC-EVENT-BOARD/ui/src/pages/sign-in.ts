// D8/D9: minimal organizer/admin sign-in. Credential failures are
// non-disclosing; service failures are distinct and offer Retry.
import { safeReturnTarget } from "../auth/return-target.js";
import { SignInError } from "../auth/session.js";
import { COPY } from "../copy.js";
import { el, focusElement, replaceChildren } from "../dom.js";
import type { PageContext } from "./context.js";

export async function renderSignIn(ctx: PageContext): Promise<void> {
  ctx.setTitle("Sign in");
  const email = el("input", {
    testid: "sign-in-email",
    attrs: { id: "sign-in-email", type: "email", autocomplete: "username", required: "" },
  });
  const password = el("input", {
    testid: "sign-in-password",
    attrs: {
      id: "sign-in-password",
      type: "password",
      autocomplete: "current-password",
      required: "",
    },
  });
  const submit = el("button", {
    text: "Sign in",
    testid: "sign-in-submit",
    attrs: { type: "submit" },
  });
  const feedback = el("div", { testid: "sign-in-feedback", attrs: { id: "sign-in-feedback" } });
  const form = el(
    "form",
    { testid: "sign-in-form", className: "narrow", attrs: { novalidate: "" } },
    [
      el("div", { className: "field" }, [
        el("label", { text: "Email", attrs: { for: "sign-in-email" } }),
        email,
      ]),
      el("div", { className: "field" }, [
        el("label", { text: "Password", attrs: { for: "sign-in-password" } }),
        password,
      ]),
      submit,
      feedback,
    ],
  );

  const showError = (message: string, retry: boolean): void => {
    const text = el("p", { text: message, testid: "sign-in-error", attrs: { role: "alert" } });
    replaceChildren(feedback, [
      text,
      retry
        ? el("button", {
            text: COPY.retry,
            testid: "sign-in-retry",
            className: "secondary",
            attrs: { type: "button" },
            on: { click: () => form.requestSubmit() },
          })
        : null,
    ]);
    for (const input of [email, password]) {
      input.setAttribute("aria-describedby", "sign-in-feedback");
    }
    ctx.announce(message);
    focusElement(text);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    if (email.value.trim() === "" || password.value === "") {
      showError("Enter your email and password.", false);
      return;
    }
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    replaceChildren(feedback, []);
    ctx.announce(COPY.signingIn);
    ctx.auth
      .signIn(email.value.trim(), password.value)
      .then((session) => {
        const target = safeReturnTarget(ctx.url.searchParams.get("returnTo"), session.role);
        return ctx.navigate(target, { replace: true });
      })
      .catch((error: unknown) => {
        if (error instanceof SignInError && error.kind === "credentials") {
          password.value = "";
          showError(COPY.signInIncorrect, false);
        } else {
          showError(COPY.signInService, true);
        }
      })
      .finally(() => {
        submit.disabled = false;
        form.removeAttribute("aria-busy");
      });
  });

  replaceChildren(ctx.main, [
    el("h1", { text: "Sign in to manage community events" }),
    el("p", {
      text: "For organizers and administrators. Browsing events and RSVPs need no account.",
    }),
    form,
  ]);
}
