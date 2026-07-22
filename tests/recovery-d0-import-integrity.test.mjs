import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import { prepareEmployeeMasterStaging } from "../app/services/import/production-workbook-staging.ts";

const mimeXlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function statusWorkbook() {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Synthetic employee master"],
    [],
    ["Empid", "CName", "Department", "Position", "JoinDate", "Employment Status"],
    ["0007", "示例员工", "Front Office", "Associate", "2026-06-01", "On Leave"],
  ]), "Sheet1");
  return {
    fileName: "synthetic-status.xlsx",
    mimeType: mimeXlsx,
    bytes: new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
  };
}

test("D0 stages an explicitly recognized employment status for authoritative review", () => {
  const result = prepareEmployeeMasterStaging(statusWorkbook());
  const mapping = result.fieldMappings.find(item => item.sourceColumnName === "Employment Status");
  assert.equal(mapping?.targetField, "employment_status");
  assert.equal(result.sourceRows[0].normalizedValues.employment_status, "leave");
});
