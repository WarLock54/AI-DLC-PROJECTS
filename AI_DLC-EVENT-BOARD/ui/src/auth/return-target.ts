// D9: accept a post-sign-in return target only when it is a same-origin local
// path to a protected route that the signed-in role may open.
import { canAccess, defaultRouteFor, type Role } from "./roles.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeReturnTarget(raw: string | null | undefined, role: Role | null): string {
  const fallback = defaultRouteFor(role);
  if (!raw || !isSafeLocalPath(raw)) {
    return fallback;
  }
  const [path, query = ""] = raw.split("?", 2);
  if (!canAccess(path, role)) {
    return fallback;
  }
  return query ? `${path}?${query}` : path;
}

function isSafeLocalPath(raw: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return false;
  }
  for (const value of [raw, decoded]) {
    if (
      !value.startsWith("/") ||
      value.includes("//") ||
      value.includes("\\") ||
      value.includes(":") ||
      value.includes("#") ||
      CONTROL_CHARACTERS.test(value)
    ) {
      return false;
    }
  }
  return true;
}
