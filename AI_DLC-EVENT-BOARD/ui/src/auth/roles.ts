// Roles drive navigation and route guards only; the backend stays the
// authorization boundary for every request.

export type Role = "admin" | "organizer";

/** Protected routes and the roles allowed to open them (D6). */
export const PROTECTED_ROUTES: Readonly<Record<string, readonly Role[]>> = {
  "/organizer/events": ["organizer", "admin"],
  "/admin/events": ["admin"],
  "/admin/stats": ["admin"],
};

/** Admin takes precedence when a user belongs to both groups. */
export function roleFromGroups(groups: readonly string[]): Role | null {
  if (groups.includes("admin")) {
    return "admin";
  }
  if (groups.includes("organizer")) {
    return "organizer";
  }
  return null;
}

export function defaultRouteFor(role: Role | null): string {
  if (role === "admin") {
    return "/admin/events";
  }
  if (role === "organizer") {
    return "/organizer/events";
  }
  return "/events";
}

export function canAccess(path: string, role: Role | null): boolean {
  const allowed = PROTECTED_ROUTES[path];
  return allowed !== undefined && role !== null && allowed.includes(role);
}
