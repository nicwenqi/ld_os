import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("C2 derives Property Ready for Employee Baseline only from confirmed activation and authorized organization facts", async () => {
  const { deriveC2EmployeeBaselineReadiness, resolveC2InitializationState } = await import("../app/services/c2-activation-readiness.ts");
  assert.equal(resolveC2InitializationState({
    completedAt: "2026-07-30T00:00:00.000Z",
    propertySettingsState: "in_progress",
  }), "ready", "a completed activation must not be masked by a stale settings read");

  const ready = deriveC2EmployeeBaselineReadiness({
    initializationState: "ready",
    activeDepartments: 2,
    activePropertyManagers: 1,
    activeDepartmentAdministrators: 1,
    activeDepartmentAdministratorsWithScope: 1,
  });
  assert.equal(ready.ready, true);
  assert.equal(ready.label, "Property Ready for Employee Baseline");
  assert.equal(ready.checks.every((check) => check.state === "ready" || check.optional), true);

  const unscopedDepartmentRole = deriveC2EmployeeBaselineReadiness({
    initializationState: "ready",
    activeDepartments: 2,
    activePropertyManagers: 1,
    activeDepartmentAdministrators: 1,
    activeDepartmentAdministratorsWithScope: 0,
  });
  assert.equal(unscopedDepartmentRole.ready, false);
  assert.match(unscopedDepartmentRole.nextAction, /部门范围/);

  const incompleteActivation = deriveC2EmployeeBaselineReadiness({
    initializationState: "in_progress",
    activeDepartments: 2,
    activePropertyManagers: 1,
    activeDepartmentAdministrators: 0,
    activeDepartmentAdministratorsWithScope: 0,
  });
  assert.equal(incompleteActivation.ready, false);
  assert.match(incompleteActivation.nextAction, /启用复核/);
});

test("C2 activation UI presents the manager-only baseline gate and the server resolves scope facts", async () => {
  const [page, readiness, accessRoute, accessStep, styles] = await Promise.all([
    readFile("app/initialize/page.tsx", "utf8"),
    readFile("app/services/c2-activation-readiness.ts", "utf8"),
    readFile("app/api/initialization/access/route.ts", "utf8"),
    readFile("app/initialize/AccessSetupStep.tsx", "utf8"),
    readFile("app/initialization-wizard.css", "utf8"),
  ]);
  assert.match(readiness, /Property Ready for Employee Baseline/);
  assert.match(page, /deriveC2EmployeeBaselineReadiness/);
  assert.match(page, /resolveC2InitializationState/);
  assert.match(accessRoute, /trainer_scopes/);
  assert.match(accessRoute, /activeDepartmentAdministratorsWithScope/);
  assert.match(accessStep, /已配置明确范围/);
  assert.match(styles, /\.wizard-primary,\.wizard-link-button\{min-height:44px/);
  assert.doesNotMatch(page, /createEmployee|Employee Fact Version|Requirement|Training Plan|Session Revision|Completion Evidence/);
});
