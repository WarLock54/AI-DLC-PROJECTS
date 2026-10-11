// Small DOM helpers. Text is always set through `textContent` (or text nodes);
// nothing in the UI assigns `innerHTML` with data.

export type Child = Node | string | null | undefined | false;

export interface ElementOptions {
  text?: string;
  testid?: string;
  className?: string;
  attrs?: Record<string, string | undefined>;
  on?: Record<string, (event: Event) => void>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) {
    element.className = options.className;
  }
  if (options.testid) {
    element.setAttribute("data-testid", options.testid);
  }
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== undefined) {
      element.setAttribute(name, value);
    }
  }
  for (const [type, listener] of Object.entries(options.on ?? {})) {
    element.addEventListener(type, listener);
  }
  if (options.text !== undefined) {
    element.textContent = options.text;
  }
  append(element, children);
  return element;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

export function clear(element: Element): void {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

export function replaceChildren(element: Element, children: Child[]): void {
  clear(element);
  append(element, children);
}

/** A same-origin link handled by the client-side router. */
export function link(
  href: string,
  text: string,
  testid: string,
  className?: string,
): HTMLAnchorElement {
  return el("a", { text, testid, className, attrs: { href, "data-link": "" } });
}

/**
 * Re-announces a message in a polite live region. Clearing first makes screen
 * readers announce repeated identical messages.
 */
export function announceIn(region: Element, message: string): void {
  region.textContent = "";
  region.textContent = message;
}

/** Moves focus to the element, making it programmatically focusable if needed. */
export function focusElement(element: HTMLElement | null): void {
  if (!element) {
    return;
  }
  if (!element.hasAttribute("tabindex") && !isNativelyFocusable(element)) {
    element.setAttribute("tabindex", "-1");
  }
  element.focus();
}

function isNativelyFocusable(element: HTMLElement): boolean {
  return ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
}

/** Shows or clears a field error and links it to the input with aria-describedby. */
export function setFieldError(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  errorElement: HTMLElement,
  message: string | null,
): void {
  errorElement.textContent = message ?? "";
  errorElement.hidden = !message;
  if (message) {
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", errorElement.id);
  } else {
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-describedby");
  }
}
