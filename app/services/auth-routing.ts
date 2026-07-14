import type { EffectiveRole } from "../repositories/contracts/auth-repository.ts";

export function homeForRole(role: EffectiveRole): string {
  return {
    platform_admin: "/platform",
    tenant_admin: "/",
    property_ld_manager: "/",
    department_training_admin: "/department",
    employee: "/my-training",
    unauthorized: "/access-denied",
  }[role];
}

const managerRoutes = ["/", "/organization", "/calendar", "/effectiveness", "/risk", "/people", "/kpi", "/permissions", "/import", "/settings", "/initialize", "/sessions"];

export function canRoleAccessPath(role: EffectiveRole, pathname: string): boolean {
  if (pathname === "/login" || pathname === "/access-denied") return true;
  if (role === "platform_admin") return pathname === "/platform" || managerRoutes.some(path => matches(pathname, path));
  if (role === "tenant_admin" || role === "property_ld_manager") return managerRoutes.some(path => matches(pathname, path));
  if (role === "department_training_admin") return pathname === "/department";
  if (role === "employee") return pathname === "/my-training";
  return false;
}

function matches(pathname: string, route: string) {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(`${route}/`);
}
