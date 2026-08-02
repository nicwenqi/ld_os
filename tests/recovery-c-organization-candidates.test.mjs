import test from "node:test";
import assert from "node:assert/strict";
import { buildOrganizationCandidatePreview } from "../app/services/import/organization-candidates.ts";
import { inspectWorkbook } from "../app/services/import/workbook-parser.ts";
import * as XLSX from "xlsx";

const rows = [
  { rowId: "r1", rowNumber: 4, employeeNumber: "0001", name: "甲", sourceDepartment: "Front Office", normalizedDepartment: "front office", sourcePosition: "Agent", normalizedPosition: "agent", sourceBand: "L1", normalizedBand: "l1", sourceEmploymentCategory: null, gender: "男" },
  { rowId: "r2", rowNumber: 5, employeeNumber: "0002", name: "乙", sourceDepartment: "Front Office", normalizedDepartment: "front office", sourcePosition: "Agent", normalizedPosition: "agent", sourceBand: "L10", normalizedBand: "l10", sourceEmploymentCategory: null, gender: "女" },
  { rowId: "r3", rowNumber: 6, employeeNumber: "0003", name: "丙", sourceDepartment: "Pastry", normalizedDepartment: "pastry", sourcePosition: "Agent", normalizedPosition: "agent", sourceBand: "T", normalizedBand: "t", sourceEmploymentCategory: "Trainee", gender: "男" },
  { rowId: "r4", rowNumber: 7, employeeNumber: "0004", name: "丁", sourceDepartment: "", normalizedDepartment: "", sourcePosition: "Agent", normalizedPosition: "agent", sourceBand: "L1", normalizedBand: "l1", sourceEmploymentCategory: null, gender: "女" },
];

test("organization candidate preview groups positions by department, not by band", () => {
  const preview = buildOrganizationCandidatePreview(rows);
  assert.deepEqual(preview.summary, { employees: 4, departments: 2, positions: 2, bands: 2, trainees: 1, unresolvedEmployees: 1 });
  assert.equal(preview.positions.length, 2);
  assert.deepEqual(preview.positions.map((item) => item.departmentSource).sort(), ["Front Office", "Pastry"]);
  assert.deepEqual(preview.positions.find((item) => item.departmentSource === "Front Office")?.bands, ["L1", "L10"]);
  assert.equal(preview.positions.find((item) => item.departmentSource === "Front Office")?.familySuggestion, null);
});

test("organization candidate preview preserves source and normalized values and marks trainee outside band ordering", () => {
  const preview = buildOrganizationCandidatePreview(rows);
  const trainee = preview.employees.find((item) => item.employeeNumber === "0003");
  assert.equal(trainee?.sourceBand, "T");
  assert.equal(trainee?.employmentCategory, "Trainee");
  assert.equal(trainee?.band, null);
  assert.equal(trainee?.status, "eligible");
  assert.equal(preview.bands.some((item) => item.sourceValue === "T"), false);
  assert.equal(preview.departments[0].sourceValue.length > 0, true);
  assert.equal(preview.departments[0].normalizedValue.length > 0, true);
});

test("missing department remains unable to determine and is not assigned to a candidate", () => {
  const preview = buildOrganizationCandidatePreview(rows);
  const unresolved = preview.employees.find((item) => item.employeeNumber === "0004");
  assert.equal(unresolved?.status, "unable_to_determine");
  assert.deepEqual(unresolved?.reasons, ["missing_department"]);
});

test("Gender is a recognized employee-master field while training columns remain excluded", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Empid", "CName", "Department", "Position", "Grade", "Gender", "CTC"],
    ["0001", "甲", "Front Office", "Agent", "L1", "男", "Completed"],
  ]), "Sheet1");
  const result = inspectWorkbook({ fileName: "gender.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })) });
  assert.equal(result.sheets[0].suggestedMappings.find((item) => item.sourceColumn === "Gender")?.targetField, "gender");
  assert.equal(result.sheets[0].suggestedMappings.find((item) => item.sourceColumn === "CTC")?.excluded, true);
});
