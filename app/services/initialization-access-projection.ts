import type { InitializationAccessSummary } from "../repositories/contracts/initialization-repository.ts";

export function parseInitializationAccessSummary(
  value: unknown,
): InitializationAccessSummary | null {
  if (!isRecord(value)) return null;
  const manager = parseManager(value.currentManager);
  if (value.currentManager !== null && manager === null) return null;
  const managerCount = nonNegativeInteger(value.activePropertyManagers);
  const administratorCount = nonNegativeInteger(value.activeDepartmentAdministrators);
  const scopedAdministratorCount = nonNegativeInteger(
    value.activeDepartmentAdministratorsWithScope,
  );
  if (
    managerCount === null
    || administratorCount === null
    || scopedAdministratorCount === null
    || scopedAdministratorCount > administratorCount
    || typeof value.departmentScopesResolved !== "boolean"
    || typeof value.canConfirm !== "boolean"
    || value.departmentScopesResolved !== (scopedAdministratorCount === administratorCount)
    || value.canConfirm !== (managerCount > 0)
  ) return null;
  return {
    currentManager: manager,
    activePropertyManagers: managerCount,
    activeDepartmentAdministrators: administratorCount,
    activeDepartmentAdministratorsWithScope: scopedAdministratorCount,
    departmentScopesResolved: value.departmentScopesResolved,
    canConfirm: value.canConfirm,
  };
}

function parseManager(value: unknown): InitializationAccessSummary["currentManager"] {
  if (value === null) return null;
  if (
    !isRecord(value)
    || typeof value.displayName !== "string"
    || typeof value.loginId !== "string"
    || typeof value.accountStatus !== "string"
  ) return null;
  return {
    displayName: value.displayName,
    loginId: value.loginId,
    accountStatus: value.accountStatus,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
