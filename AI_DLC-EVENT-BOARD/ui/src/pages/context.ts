import type { ApiClient } from "../api/client.js";
import type { AuthService, SessionInfo } from "../auth/session.js";

/** What every page receives from the composition root (app.ts). */
export interface PageContext {
  main: HTMLElement;
  api: ApiClient;
  auth: AuthService;
  session: SessionInfo | null;
  params: Record<string, string>;
  url: URL;
  fetchImpl: typeof fetch;
  announce(message: string): void;
  navigate(path: string, options?: { replace?: boolean }): Promise<void>;
  setTitle(title: string): void;
}
