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
  const scopes = session.departmentScopes;
  const propertyId = await resolvePropertyId(registry, session);
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

  // Recovery A has no server-scoped employee endpoint and the validated RLS
  // foundation does not yet grant department responsible persons employee
  // reads. Do not compensate by downloading the hotel tree or interpreting an
  // RLS-filtered empty result as a real zero. The authorized scope summary in
  // the session remains usable while employee facts stay explicitly unavailable.
  if (registry.environment.dataMode !== "mock") {
    return {
      presentationState: "unavailable",
      refreshedAt: new Date().toISOString(),
      scopes,
      authorizedDepartments: [],
      employees: [],
      errors: [],
    };
  }

  const treeResult = await Promise.allSettled([
    registry.department.listTree(propertyId),
  ]).then(([result]) => result);
  const tree = treeResult.status === "fulfilled" ? treeResult.value : [];
  const errors =
    treeResult.status === "rejected"
      ? [message(treeResult.reason, "无法读取授权部门结构")]
      : [];
  const authorizedDepartments = authorizedNodes(
    tree,
    scopes,
    registry.environment.dataMode === "mock",
  );
  const allowedIds = new Set<string>(scopes.map(scope => scope.departmentId));
  for (const department of authorizedDepartments) allowedIds.add(department.id);

  // Query only the authorized branch IDs. Existing RLS remains the primary
  // database boundary; the filter below is a fail-closed application boundary.
  const employeeResults = await Promise.allSettled(
    [...allowedIds].map(departmentId =>
      registry.employee.listEmployees(propertyId, {
        departmentId,
        active: true,
      }),
    ),
  );
  for (const result of employeeResults) {
    if (result.status === "rejected") {
      errors.push(message(result.reason, "无法读取授权部门员工"));
    }
  }

  const allowedCodes = new Set(
    authorizedDepartments
      .map(department => department.code)
      .filter((code): code is string => Boolean(code)),
  );
  const employees = deduplicateEmployees(
    employeeResults.flatMap(result =>
      result.status === "fulfilled" ? result.value : [],
    ),
  ).filter(employee =>
    employeeWithinScope({
      employee,
      propertyId,
      scopes,
      allowedIds,
      allowedCodes,
      mockMode: registry.environment.dataMode === "mock",
    }),
  );

  return {
    presentationState:
      errors.length > 0
        ? "partial"
        : registry.environment.dataMode === "mock"
          ? "demo"
          : "real",
    refreshedAt: new Date().toISOString(),
    scopes,
    authorizedDepartments,
    employees,
    errors: [...new Set(errors)],
  };
}

function authorizedNodes(
  tree: readonly DepartmentNode[],
  scopes: readonly AuthorizedDepartmentScope[],
  mockMode: boolean,
) {
  const authorized = new Map<string, DepartmentNode>();
  for (const scope of scopes) {
    const root =
      tree.find(department => department.id === scope.departmentId) ??
      (mockMode
        ? tree.find(
            department =>
              department.code === scope.departmentId ||
              department.nameZh === scope.departmentNameZh,
          )
        : undefined);
    if (!root) continue;
    authorized.set(root.id, root);
    if (!scope.includeDescendants) continue;
    for (const department of tree) {
      if (department.pathIds.includes(root.id)) {
        authorized.set(department.id, department);
      }
    }
  }
  return [...authorized.values()];
}

function employeeWithinScope(input: {
  employee: EmployeeRecord;
  propertyId: string;
  scopes: readonly AuthorizedDepartmentScope[];
  allowedIds: ReadonlySet<string>;
  allowedCodes: ReadonlySet<string>;
  mockMode: boolean;
}) {
  const { employee, propertyId, scopes, allowedIds, allowedCodes, mockMode } = input;
  if (!mockMode && employee.propertyId !== propertyId) return false;
  if (allowedIds.has(employee.departmentId)) return true;
  if (!mockMode) return false;
  if (allowedCodes.has(employee.departmentId)) return true;

  // Local fixture IDs intentionally differ from the validated UUID fixtures.
  // This name-segment fallback exists only in mock mode and never weakens the
  // production department-ID boundary.
  const employeePath = splitDepartmentPath(employee.departmentName);
  return scopes.some(scope => {
    const rootName = scope.departmentNameZh;
    const rootIndex = employeePath.indexOf(rootName);
    if (rootIndex < 0) return false;
    if (scope.includeDescendants) return true;
    return employeePath.at(-1) === rootName;
  });
}

function splitDepartmentPath(value: string) {
  return value
    .split(/\s*(?:›|>|\/|／)\s*/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

function deduplicateEmployees(employees: readonly EmployeeRecord[]) {
  return [...new Map(employees.map(employee => [employee.id, employee])).values()].sort(
    (left, right) =>
      left.employeeNumber.localeCompare(right.employeeNumber, "zh-CN", {
        numeric: true,
      }),
  );
}

async function resolvePropertyId(registry: Registry, session: AuthSession) {
  if (registry.environment.dataMode !== "mock") return session.propertyId;
  try {
    return (
      await registry.property.resolveContext("training-demo.example.test")
    )?.propertyId ?? null;
  } catch {
    return null;
  }
}

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
