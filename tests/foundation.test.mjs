import assert from "node:assert/strict";
import test from "node:test";
import { departments } from "../app/data/departments.ts";
import { employees } from "../app/data/employees.ts";
import { courses, trainers } from "../app/data/courses.ts";
import { sessions } from "../app/data/sessions.ts";
import { kpiDefinitions } from "../app/data/kpis.ts";
import {
  getDepartmentBreadcrumb,
  getDescendantIds,
  isWithinScope,
} from "../app/lib/department-tree.ts";
import {
  calculateCompletion,
  calculateGap,
  calculateHealthScore,
  resolveTarget,
} from "../app/lib/kpi-math.ts";

test("mock domain is complete and relationally coherent", () => {
  assert.equal(departments.filter((item) => item.level === 1).length, 7);
  assert.ok(departments.length >= 20);
  assert.ok(employees.length >= 80);
  assert.equal(courses.length, 12);
  assert.ok(trainers.length >= 8);
  assert.ok(sessions.length >= 18);
  assert.equal(kpiDefinitions.length, 8);
  const departmentIds = new Set(departments.map((item) => item.id));
  for (const employee of employees) {
    assert.ok(departmentIds.has(employee.departmentId));
    assert.ok(employee.employeeId && employee.nameZh && employee.nameEn);
  }
});

test("department hierarchy scopes descendants and breadcrumbs correctly", () => {
  assert.deepEqual(getDescendantIds("rooms").slice(0, 4), [
    "rooms",
    "front-office",
    "concierge",
    "front-desk",
  ]);
  assert.equal(isWithinScope("concierge", "rooms"), true);
  assert.equal(isWithinScope("front-desk", "concierge"), false);
  assert.deepEqual(
    getDepartmentBreadcrumb("concierge").map((item) => item.id),
    ["rooms", "front-office", "concierge"],
  );
});

test("KPI targets inherit and health score is capped", () => {
  assert.equal(resolveTarget("hours", "concierge", "month"), 4.5);
  assert.equal(calculateCompletion(4.2, 4), 105);
  assert.equal(calculateGap(4.2, 4), 0.2);
  assert.equal(calculateHealthScore([
    { completion: 140, weight: 50 },
    { completion: 80, weight: 50 },
  ]), 90);
});
