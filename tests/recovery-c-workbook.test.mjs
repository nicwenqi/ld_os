import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import * as XLSX from "xlsx";

import { inspectEmployeeMasterAggregate } from "../app/services/import/workbook-parser.ts";
import { prepareEmployeeMasterStaging } from "../app/services/import/production-workbook-staging.ts";

const mimeXlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const approvedHeaders = ["Empid", "CName", "EName", "Department", "Position", "Grade", "JoinDate", "Probation"];

function exclusionPatternsFromSources() {
  const parserSource = readFileSync(
    new URL("../app/services/import/workbook-parser.ts", import.meta.url),
    "utf8",
  );
  const parserMatch = parserSource.match(
    /const excludedPattern = \/(.+)\/i;/,
  );
  assert.ok(parserMatch, "parser exclusion regex must remain discoverable");

  const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
  const latestMigration = readdirSync(migrationsUrl)
    .filter(name => name.endsWith(".sql"))
    .sort()
    .reverse()
    .map(name => readFileSync(new URL(name, migrationsUrl), "utf8"))
    .find(source =>
      source.includes(
        "create or replace function app_private.is_employee_import_excluded_key",
      ));
  assert.ok(latestMigration, "database exclusion helper migration must exist");
  const functionMatch = latestMigration.match(
    /create or replace function\s+app_private\.is_employee_import_excluded_key[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
  );
  assert.ok(functionMatch, "latest database exclusion helper must be readable");
  const expressionMatch = functionMatch[1].match(
    /~\*\s*\(([\s\S]*?)\)\s*;/,
  );
  assert.ok(expressionMatch, "database exclusion regex must remain discoverable");
  const databasePattern = [...expressionMatch[1].matchAll(/'([^']*)'/g)]
    .map(match => match[1].replaceAll("''", "'"))
    .join("");

  return {
    parser: new RegExp(parserMatch[1], "i"),
    database: new RegExp(databasePattern, "i"),
  };
}

function workbookFile({
  headers = approvedHeaders,
  rows,
  extraSheets = [],
  fileName = "synthetic-recovery-c.xlsx",
}) {
  const workbook = XLSX.utils.book_new();
  const employeeSheet = XLSX.utils.aoa_to_sheet([
    ["Synthetic employee master"],
    [],
    headers,
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(workbook, employeeSheet, "Sheet1");
  for (const { name, values } of extraSheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), name);
  }
  return {
    fileName,
    mimeType: mimeXlsx,
    bytes: new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" })),
  };
}

function syntheticWorkbookWithTrainingColumns() {
  return workbookFile({
    headers: [...approvedHeaders, "CTC", "GTC", "Mini Orientation", "Gender"],
    rows: [[
      "0007",
      "示例员工甲",
      "Synthetic Associate A",
      "Front Office",
      "Guest Service Associate",
      "G5",
      "2026-06-01",
      "2026-09-01",
      "Complete",
      "Complete",
      "Complete",
      "X",
    ]],
  });
}

test("Recovery C staging never persists excluded workbook values", () => {
  const result = prepareEmployeeMasterStaging(syntheticWorkbookWithTrainingColumns());
  assert.equal(result.sourceRows[0].rawValues.CTC, undefined);
  assert.equal(result.sourceRows[0].rawValues.GTC, undefined);
  assert.equal(result.sourceRows[0].rawValues["Mini Orientation"], undefined);
  assert.equal(result.sourceRows[0].rawValues.Gender, undefined);
  assert.equal(result.fieldMappings.some(item => item.sourceColumnName === "CTC"), false);
  assert.equal(result.safeSummary.trainingHistoryImported, false);
  assert.equal(result.safeSummary.ctcGtcImported, false);
  assert.deepEqual(
    Object.keys(result.sourceRows[0].rawValues).sort(),
    [...approvedHeaders].sort(),
  );
  assert.deepEqual(
    result.safeSummary.excludedColumns.map(item => item.sourceColumnName),
    ["CTC", "GTC", "Mini Orientation", "Gender"],
  );
  assert.equal(result.safeSummary.excludedColumns.every(item => item.reason.length > 0), true);
});

test("database employee exclusions cover every parser category and retained evidence category", () => {
  const patterns = exclusionPatternsFromSources();
  const parserRepresentatives = [
    "Gender",
    "性别",
    "CTC",
    "GTC",
    "Course",
    "Training",
    "培训",
    "Completion",
    "完成",
    "Orientation",
    "入职引导",
    "Onboarding",
    "Checklist",
    "清单",
    "Journey",
    "旅程",
    "First Aid",
    "FirstAid",
    "急救",
    "Problem Handling",
    "ProblemHandling",
    "问题处理",
  ];
  const retainedDatabaseRepresentatives = [
    "课程",
    "Attendance",
    "出勤",
    "考勤",
    "Feedback",
    "反馈",
    "Risk",
    "风险",
    "KPI",
    "绩效",
  ];

  for (const key of parserRepresentatives) {
    assert.equal(patterns.parser.test(key), true, `parser must exclude ${key}`);
    assert.equal(
      patterns.database.test(key),
      true,
      `database must cover parser exclusion ${key}`,
    );
  }
  for (const key of retainedDatabaseRepresentatives) {
    assert.equal(
      patterns.database.test(key),
      true,
      `database must retain evidence exclusion ${key}`,
    );
  }
  for (const key of approvedHeaders) {
    assert.equal(patterns.parser.test(key), false, `parser must allow ${key}`);
    assert.equal(patterns.database.test(key), false, `database must allow ${key}`);
  }
});

test("Recovery C aggregate evidence omits row values and the full checksum", () => {
  const result = prepareEmployeeMasterStaging(syntheticWorkbookWithTrainingColumns());
  const serialized = JSON.stringify(result.safeSummary);
  assert.doesNotMatch(serialized, /0007|示例员工甲|Synthetic Associate A|Complete/);
  assert.equal(result.safeSummary.checksum, undefined);
  assert.match(result.safeSummary.checksumPrefix, /^[0-9a-f]{12}$/);
  assert.equal(result.inspection.checksum.startsWith(result.safeSummary.checksumPrefix), true);
  assert.equal(result.inspection.checksum.length, 64);
});

test("Recovery C preserves leading-zero employee numbers as approved text evidence", () => {
  const result = prepareEmployeeMasterStaging(workbookFile({
    rows: [[
      "0007",
      "示例员工甲",
      "Synthetic Associate A",
      "Front Office",
      "Guest Service Associate",
      "G5",
      "2026-06-01",
      "2026-09-01",
    ]],
  }));

  assert.equal(result.sourceRows[0].rawValues.Empid, "0007");
  assert.equal(result.sourceRows[0].normalizedValues.employee_number, "0007");
});

test("Recovery C blocks empty and whitespace-only department values", () => {
  const result = prepareEmployeeMasterStaging(workbookFile({
    rows: [
      ["0007", "示例员工甲", "Synthetic A", undefined, "Associate", "G5", "2026-06-01", "2026-09-01"],
      ["0008", "示例员工乙", "Synthetic B", "   ", "Associate", "G5", "2026-06-02", "2026-09-02"],
    ],
  }));

  assert.equal(result.sourceRows.length, 2);
  assert.equal(result.safeSummary.blockedRows, 2);
  assert.equal(
    result.sourceRows.every(row => row.validationSummary.blockingIssues.includes("unresolved_department")),
    true,
  );
});

test("Recovery C blocks every row sharing a duplicate employee number", () => {
  const result = prepareEmployeeMasterStaging(workbookFile({
    rows: [
      ["0007", "示例员工甲", "Synthetic A", "Front Office", "Associate", "G5", "2026-06-01", "2026-09-01"],
      ["0007", "示例员工乙", "Synthetic B", "Engineering", "Engineer", "G6", "2026-06-02", "2026-09-02"],
    ],
  }));

  assert.equal(result.sourceRows.length, 2);
  assert.equal(
    result.sourceRows.every(row => row.validationSummary.blockingIssues.includes("duplicate_employee_number_in_file")),
    true,
  );
  assert.equal(result.safeSummary.blockedRows, 2);
});

test("Recovery C rejects duplicate approved columns targeting the same employee field", () => {
  assert.throws(
    () => prepareEmployeeMasterStaging(workbookFile({
      headers: ["Empid", "Employee Number", ...approvedHeaders.slice(1)],
      rows: [[
        "0007",
        "9999",
        "示例员工甲",
        "Synthetic A",
        "Front Office",
        "Associate",
        "G5",
        "2026-06-01",
        "2026-09-01",
      ]],
    })),
    /多个列映射到同一员工字段：employee_number/,
  );
});

test("Recovery C turns ambiguous dates into warnings instead of guessed dates", () => {
  const result = prepareEmployeeMasterStaging(workbookFile({
    rows: [[
      "0007",
      "示例员工甲",
      "Synthetic A",
      "Front Office",
      "Associate",
      "G5",
      "2026-06-01 / 2026-06-02",
      "2026-09-01",
    ]],
  }));

  assert.equal(result.sourceRows[0].normalizedValues.hire_date, null);
  assert.deepEqual(result.sourceRows[0].validationSummary.warningIssues, ["invalid_date"]);
  assert.equal(result.sourceRows[0].processingStatus, "warning");
});

test("Recovery C stages missing employee numbers only as blocked evidence", () => {
  const input = workbookFile({
    rows: [[
      undefined,
      "示例员工甲",
      "Synthetic A",
      "Front Office",
      "Associate",
      "G5",
      "2026-06-01",
      "2026-09-01",
    ]],
  });
  const result = prepareEmployeeMasterStaging(input);
  const aggregate = inspectEmployeeMasterAggregate(input);

  assert.equal(result.sourceRows.length, 1);
  assert.equal(result.sourceRows[0].normalizedValues.employee_number, null);
  assert.deepEqual(result.sourceRows[0].validationSummary.blockingIssues, ["missing_employee_number"]);
  assert.equal(result.safeSummary.blockedRows, 1);
  assert.equal(result.safeSummary.employeesImported, 0);
  assert.equal(aggregate.employeeMaster.sourceRows, 1);
  assert.equal(aggregate.employeeMaster.missingEmployeeNumbers, 1);
  assert.equal(aggregate.employeeMaster.structurallyValid, 0);
});

test("Recovery C excludes separate CTC and GTC sheets from employee staging", () => {
  const result = prepareEmployeeMasterStaging(workbookFile({
    rows: [[
      "0007",
      "示例员工甲",
      "Synthetic A",
      "Front Office",
      "Associate",
      "G5",
      "2026-06-01",
      "2026-09-01",
    ]],
    extraSheets: [
      { name: "CTC", values: [["Empid", "CTC"], ["0007", "Complete"]] },
      { name: "GTC", values: [["Empid", "GTC"], ["0007", "Complete"]] },
    ],
  }));

  assert.equal(result.safeSummary.detectedSheets.length, 3);
  assert.equal(result.safeSummary.selectedSheet, "Sheet1");
  assert.equal(result.sourceRows.length, 1);
  assert.deepEqual(
    result.safeSummary.excludedSheets.map(item => item.name),
    ["CTC", "GTC"],
  );
  assert.equal(result.safeSummary.excludedSheets.every(item => item.reason.length > 0), true);
});
