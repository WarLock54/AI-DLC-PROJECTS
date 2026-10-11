// Boots the real UI composition (layout, router, pages) against the fake API and
// a fake auth service, without network or Cognito.
import { vi } from "vitest";
import { createApp, type App } from "../../../../ui/src/app.js";
import type { AuthService, SessionInfo } from "../../../../ui/src/auth/session.js";
import { FakeApi, flush } from "./fake-api.js";

export class FakeAuth implements AuthService {
  session: SessionInfo | null;
  readonly signIn = vi.fn<AuthService["signIn"]>();
  readonly getSession = vi.fn(async () => this.session);
  readonly signOut = vi.fn(() => {
    this.session = null;
  });

  constructor(session: SessionInfo | null = null) {
    this.session = session;
  }
}

export interface Harness {
  api: FakeApi;
  auth: FakeAuth;
  app: App;
  root: HTMLElement;
  byTestId<T extends HTMLElement = HTMLElement>(id: string): T;
  allByTestId<T extends HTMLElement = HTMLElement>(id: string): T[];
  go(path: string): Promise<void>;
}

/** Installs a minimal <dialog> modal API when the test DOM lacks one. */
export function ensureDialogSupport(): void {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & { __c4Polyfill?: boolean };
  if (typeof proto.showModal === "function" && typeof proto.close === "function") {
    return;
  }
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute("open", "");
  };
  proto.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}

export async function startApp(
  path: string,
  options: { session?: SessionInfo | null; api?: FakeApi } = {},
): Promise<Harness> {
  ensureDialogSupport();
  document.body.replaceChildren();
  const root = document.createElement("div");
  root.id = "app";
  document.body.appendChild(root);
  window.history.replaceState(null, "", path);
  const api = options.api ?? new FakeApi();
  const auth = new FakeAuth(options.session ?? null);
  const app = createApp({ root, win: window, auth, fetchImpl: api.fetch });
  const byTestId = <T extends HTMLElement>(id: string): T => {
    const element = document.querySelector<T>(`[data-testid="${id}"]`);
    if (!element) {
      throw new Error(`No element with data-testid="${id}"`);
    }
    return element;
  };
  const allByTestId = <T extends HTMLElement>(id: string): T[] => [
    ...document.querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const go = async (target: string): Promise<void> => {
    await app.router.navigate(target);
    await flush();
  };
  await app.router.resolve();
  await flush();
  return { api, auth, app, root, byTestId, allByTestId, go };
}

export function setValue(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

export function liveText(): string {
  return document.querySelector('[data-testid="live-region"]')?.textContent ?? "";
}
