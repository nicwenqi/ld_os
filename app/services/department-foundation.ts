import type {
  AuthSession,
  AuthorizedDepartmentScope,
} from "../repositories/contracts/auth-repository.ts";
import type { EmployeeRecord } from "../repositories/contracts/employee-repository.ts";
import type { DepartmentNode } from "../repositories/contracts/organization-models.ts";
import type { createRepositoryRegistry } from "../repositories/registry.ts";
import type { FoundationPresentationState } from "./foundation-readiness.ts";

type Registry = ReturnType<typeof createRepositoryRegistry>;

export type ScopedDepartmentEmployees = {
  presentationState: FoundationPresentationState | "unavailable";
  refreshedAt: string;
  scopes: AuthorizedDepartmentScope[];
  authorizedDepartments: DepartmentNode[];
  employees: readonly EmployeeRecord[];
  errors: string[];
};

/**
 * Loads employee foundation facts for the department branches resolved by the
 * authenticated server session. It never accepts a department selected by the
 * browser and it applies a second scope boundary after repository/RLS filtering.
 */
export async function loadScopedDepartmentEmployees(
  registry: Registry,
  session: AuthSession,
): Promise<ScopedDepartmentEmployees> {
  void registry;
  const scopes = session.departmentScopes;
  const propertyId = session.propertyId;
  if (!propertyId || scopes.length === 0) {
    return {
      presentationState: "partial",
      refreshedAt: new Date().toISOString(),
      scopes,
      authorizedDepartments: [],
      employees: [],
      errors: [
        propertyId
          ? "当前账号没有可读取的授权部门范围"
          : "当前酒店上下文无法读取",
      ],
    };
  }

  // Recovery A/B has no server-scoped employee endpoint and the validated RLS
  // foundation does not yet grant department responsible persons employee
  // reads. This is also true in local review: the synthetic department account
  // must not call manager-only organization or employee repositories. The
  // authorized scope summary in the server session remains usable while
  // employee facts stay explicitly unavailable.
  return {
    presentationState: "unavailable",
    refreshedAt: new Date().toISOString(),
    scopes,
    authorizedDepartments: [],
    employees: [],
    errors: [],
  };
}
