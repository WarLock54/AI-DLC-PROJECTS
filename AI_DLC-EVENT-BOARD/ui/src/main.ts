// Browser entry point bundled to /app.js.
import { createApp, renderServiceError } from "./app.js";
import { createAuthService } from "./auth/session.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const root = document.getElementById("app");
  if (!root) {
    throw new Error("The #app root element is missing.");
  }
  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error("Community Event Board configuration failed to load.", error);
    renderServiceError(root);
    return;
  }
  const app = createApp({ root, win: window, auth: createAuthService(config) });
  await app.router.start();
}

void main();
