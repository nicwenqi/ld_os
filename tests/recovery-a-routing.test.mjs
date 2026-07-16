import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canRoleAccessPath,
  homeForRole,
  safeReturnToForRole,
} from "../app/services/auth-routing.ts";
import { authenticateSyntheticAccount } from "../app/services/authentication-service.ts";

test("Recovery A exposes exactly two authenticated hotel workspaces", async () => {
  assert.equal(homeForRole("property_ld_manager"), "/");
  assert.equal(homeForRole("department_training_responsible"), "/department");
  assert.equal(homeForRole("unauthorized"), "/access-denied");

  const contract = await readFile(
    new URL("../app/repositories/contracts/auth-repository.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(contract, /platform_admin|tenant_admin|\| "employee"/);
  assert.match(contract, /department_training_responsible/);
  assert.match(contract, /departmentScopes/);
});

test("manager and department direct-route matrices do not cross", () => {
  for (const pathname of [
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
  ]) {
    assert.equal(canRoleAccessPath("property_ld_manager", pathname), true, pathname);
  }
  for (const pathname of [
    "/department",
    "/department/calendar",
    "/department/sessions",
    "/department/employees",
    "/department/attendance-feedback",
    "/department/remediation",
    "/department/data",
  ]) {
    assert.equal(
      canRoleAccessPath("department_training_responsible", pathname),
      true,
      pathname,
    );
  }

  assert.equal(canRoleAccessPath("property_ld_manager", "/department"), false);
  assert.equal(
    canRoleAccessPath("department_training_responsible", "/people"),
    false,
  );
  assert.equal(
    canRoleAccessPath("department_training_responsible", "/settings/hotel"),
    false,
  );
  assert.equal(canRoleAccessPath("unauthorized", "/"), false);
  assert.equal(canRoleAccessPath("property_ld_manager", "/my-training"), false);
  assert.equal(canRoleAccessPath("property_ld_manager", "/platform"), false);
  assert.equal(canRoleAccessPath("property_ld_manager", "/check-in/session-1"), false);
});

test("return paths are restored only when authorized for the resolved role", () => {
  assert.equal(
    safeReturnToForRole("property_ld_manager", "/people?status=active"),
    "/people?status=active",
  );
  assert.equal(
    safeReturnToForRole(
      "department_training_responsible",
      "/department/employees?active=true",
    ),
    "/department/employees?active=true",
  );
  assert.equal(
    safeReturnToForRole("department_training_responsible", "/import"),
    "/department",
  );
  assert.equal(
    safeReturnToForRole("property_ld_manager", "https://evil.example/path"),
    "/",
  );
  assert.equal(safeReturnToForRole("property_ld_manager", "//evil.example"), "/");
  assert.equal(safeReturnToForRole("property_ld_manager", "/login"), "/");
});

test("local fixtures have no platform or employee login and expose a scoped department role", async () => {
  await assert.rejects(
    () =>
      authenticateSyntheticAccount({
        loginId: "employee",
        password: "HotelDemo2026",
        hostname: "training-demo.example.test",
        appEnv: "local",
        dataMode: "mock",
      }),
    /账号或密码错误/,
  );
  await assert.rejects(
    () =>
      authenticateSyntheticAccount({
        loginId: "platform-admin",
        password: "HotelDemo2026",
        hostname: "training-demo.example.test",
        appEnv: "local",
        dataMode: "mock",
      }),
    /账号或密码错误/,
  );
  const session = await authenticateSyntheticAccount({
    loginId: "department-responsible",
    password: "HotelDemo2026",
    hostname: "training-demo.example.test",
    appEnv: "local",
    dataMode: "mock",
  });
  assert.equal(session.role, "department_training_responsible");
  assert.equal(session.departmentScopes.length, 1);
  assert.deepEqual(session.departmentScopes[0].breadcrumb, ["房务部", "前厅部"]);
  assert.equal(session.departmentScopes[0].includeDescendants, true);
});
