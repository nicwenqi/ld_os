import type { EffectiveRole } from "../repositories/contracts/auth-repository.ts";

export function homeForRole(role: EffectiveRole): string {
  if (role === "property_ld_manager") return "/";
  if (role === "department_training_responsible") return "/department";
  return "/access-denied";
}

export const managerRoutes = [
  "/",
  "/calendar",
  "/sessions",
  "/attendance-feedback",
  "/people",
  "/interventions",
  "/plans",
  "/department-performance",
  "/kpi",
  "/effectiveness",
  "/data-quality",
  "/import",
  "/permissions",
  "/settings/hotel",
  "/initialize",
] as const;

export const departmentRoutes = [
  "/department",
  "/department/calendar",
  "/department/sessions",
  "/department/employees",
  "/department/attendance-feedback",
  "/department/remediation",
  "/department/data",
] as const;

const publicRoutes = ["/login", "/access-denied"] as const;

export function canRoleAccessPath(role: EffectiveRole, pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  if (publicRoutes.includes(normalized as (typeof publicRoutes)[number])) return true;
  if (role === "property_ld_manager") return managerRoutes.some(path => matches(normalized, path));
  if (role === "department_training_responsible") return departmentRoutes.includes(normalized as (typeof departmentRoutes)[number]);
  return false;
}

export function safeReturnToForRole(role: EffectiveRole, returnTo: string | null | undefined): string {
  const home = homeForRole(role);
  if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) return home;
  try {
    const parsed = new URL(returnTo, "https://hotel.invalid");
    if (parsed.origin !== "https://hotel.invalid") return home;
    if (publicRoutes.includes(parsed.pathname as (typeof publicRoutes)[number])) return home;
    if (!canRoleAccessPath(role, parsed.pathname)) return home;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return home;
  }
}

function matches(pathname: string, route: string) {
  if (route === "/") return pathname === "/";
  if (route === "/sessions") return pathname === route || pathname.startsWith(`${route}/`);
  return pathname === route || pathname.startsWith(`${route}/`);
}

function normalizePathname(value: string) {
  try {
    return new URL(value, "https://hotel.invalid").pathname.replace(/\/$/, "") || "/";
  } catch {
    return value.split(/[?#]/, 1)[0].replace(/\/$/, "") || "/";
  }
}
