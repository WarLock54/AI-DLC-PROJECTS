// Native <dialog> confirmation. Escape and Cancel close without confirming; focus
// always returns to the trigger.
import { el } from "../dom.js";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  testid: string;
  trigger: HTMLElement;
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const titleId = `${options.testid}-title`;
    const cancel = el("button", {
      text: "Cancel",
      testid: `${options.testid}-cancel`,
      className: "secondary",
      attrs: { type: "button" },
    });
    const confirm = el("button", {
      text: options.confirmLabel,
      testid: `${options.testid}-confirm`,
      className: "danger",
      attrs: { type: "button" },
    });
    const dialog = el("dialog", { testid: options.testid, attrs: { "aria-labelledby": titleId } }, [
      el("h2", { text: options.title, attrs: { id: titleId } }),
      el("p", { text: options.body }),
      el("div", { className: "actions" }, [cancel, confirm]),
    ]);
    const close = (): void => {
      if (dialog.open) {
        dialog.close();
      } else {
        finish();
      }
    };
    const finish = (): void => {
      dialog.remove();
      options.trigger.focus();
      resolve(confirmed);
    };
    cancel.addEventListener("click", close);
    confirm.addEventListener("click", () => {
      confirmed = true;
      close();
    });
    dialog.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        event.preventDefault();
        close();
      }
    });
    dialog.addEventListener("close", finish, { once: true });
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
