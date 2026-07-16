import type {
  AuthSession,
  AuthorizedDepartmentScope,
} from "../repositories/contracts/auth-repository.ts";
import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeRecord,
} from "../repositories/contracts/employee-repository.ts";
import type { DepartmentNode } from "../repositories/contracts/organization-models.ts";
import type { createRepositoryRegistry } from "../repositories/registry.ts";
import { createEmployeeService } from "./employee-service.ts";
import {
  foundationPresentationState,
  type FoundationPresentationState,
} from "./foundation-readiness.ts";

type Registry = ReturnType<typeof createRepositoryRegistry>;

export type ScopedDepartmentEmployees = {
  presentationState: FoundationPresentationState | "unavailable";
  refreshedAt: string;
  scopes: AuthorizedDepartmentScope[];
  authorizedDepartments: DepartmentNode[];
  employees: readonly EmployeeRecord[];
  total: number;
  errors: string[];
};

/**
 * Loads employee foundation facts for the department branches resolved by the
 * authenticated server session. It accepts search and pagination only; the
 * repository RPC derives department scope from the authenticated actor.
 */
export async function loadScopedDepartmentEmployees(
  registry: Registry,
  session: AuthSession,
  options: DepartmentEmployeeDirectoryOptions & Record<string, unknown> = {},
): Promise<ScopedDepartmentEmployees> {
  const scopes = session.departmentScopes;
  const propertyId = session.propertyId;
  if (
    session.role !== "department_training_responsible" ||
    !propertyId ||
    scopes.length === 0
  ) {
    return {
      presentationState: "partial",
      refreshedAt: new Date().toISOString(),
      scopes,
      authorizedDepartments: [],
      employees: [],
      total: 0,
      errors: [
        session.role !== "department_training_responsible"
          ? "当前账号不是部门培训负责人"
          : propertyId
            ? "当前账号没有可读取的授权部门范围"
            : "当前酒店上下文无法读取",
      ],
    };
  }

  const directory = await createEmployeeService(
    registry.employee,
  ).listDepartmentDirectory({
    ...options,
    limit: options.limit ?? 100,
    offset: options.offset ?? 0,
  });

  return {
    presentationState: foundationPresentationState(
      registry.environment.dataMode,
      false,
    ),
    refreshedAt: directory.refreshedAt,
    scopes,
    authorizedDepartments: [],
    employees: directory.rows,
    total: directory.total,
    errors: [],
  };
}
