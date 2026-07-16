import assert from "node:assert/strict";
import test from "node:test";

import { createEmployeeService } from "../app/services/employee-service.ts";

const employee = {
  id: "employee-1",
  tenantId: "tenant-1",
  propertyId: "property-1",
  employeeNumber: "0007",
  nameZh: "示例员工",
  nameEn: "Synthetic Associate",
  departmentId: "department-1",
  departmentName: "房务部 › 前厅部",
  operationalUnitId: null,
  operationalUnitName: null,
  positionId: "position-1",
  positionName: "宾客服务专员",
  positionFamilyId: "family-1",
  positionFamilyName: "一线员工",
  gradeOrBand: "A2",
  hireDate: "2026-06-01",
  probationOrConfirmationDate: "2026-09-01",
  employmentStatus: "active",
  isNewEmployee: true,
  isActive: true,
  externalIdentifierTypes: [],
  version: 1,
};

test("Recovery C employee service uses server pagination and preserves manager filters", async () => {
  const calls = [];
  const repository = {
    async listEmployeesPage(propertyId, options) {
      calls.push(["manager", propertyId, options]);
      return { rows: [employee], total: 196, refreshedAt: "2026-07-16T09:00:00.000Z" };
    },
    async listDepartmentEmployees(options) {
      calls.push(["department", options]);
      return { rows: [employee], total: 1, refreshedAt: "2026-07-16T09:00:00.000Z" };
    },
    async getEmployee(id) {
      calls.push(["get", id]);
      return employee;
    },
  };
  const service = createEmployeeService(repository);
  const page = await service.listManagerDirectory("property-1", {
    query: "0007",
    departmentId: "department-1",
    positionFamilyId: "family-1",
    employmentStatus: "active",
    limit: 500,
    offset: -20,
  });
  assert.equal(page.total, 196);
  assert.deepEqual(calls[0], ["manager", "property-1", {
    query: "0007",
    departmentId: "department-1",
    positionFamilyId: "family-1",
    employmentStatus: "active",
    limit: 100,
    offset: 0,
  }]);

  await service.refreshEmployee("employee-1");
  assert.deepEqual(calls[1], ["get", "employee-1"]);
});

test("Recovery C department directory never accepts a property or browser-selected department scope", async () => {
  let received;
  const repository = {
    async listEmployeesPage() {
      throw new Error("manager path must not be used");
    },
    async listDepartmentEmployees(options) {
      received = options;
      return { rows: [employee], total: 1, refreshedAt: "2026-07-16T09:00:00.000Z" };
    },
    async getEmployee() {
      return null;
    },
  };
  const service = createEmployeeService(repository);
  const page = await service.listDepartmentDirectory({
    query: "示例",
    limit: 25,
    offset: 0,
    propertyId: "forged-property",
    departmentId: "forged-department",
  });
  assert.equal(page.rows[0].employeeNumber, "0007");
  assert.deepEqual(received, { query: "示例", limit: 25, offset: 0 });
  assert.equal("propertyId" in received, false);
  assert.equal("departmentId" in received, false);
});
