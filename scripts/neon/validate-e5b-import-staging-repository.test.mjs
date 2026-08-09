import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateE5bImportStagingRepositorySource } from "./validate-e5b-import-staging.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export%20{}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const {
  APPROVED_IMPORT_STAGING_ENTRYPOINTS,
  computeImportSourceRowFingerprint,
  createNeonImportStagingRepository,
} = await import("../../app/repositories/neon/import-staging-repository.ts");

const ids = Object.freeze({
  tenant: "11111111-1111-4111-8111-111111111111",
  property: "22222222-2222-4222-8222-222222222222",
  batch: "33333333-3333-4333-8333-333333333333",
  selectedSheet: "44444444-4444-4444-8444-444444444444",
  excludedSheet: "55555555-5555-4555-8555-555555555555",
  firstRow: "66666666-6666-4666-8666-666666666666",
  secondRow: "77777777-7777-4777-8777-777777777777",
});

const checksum = "a".repeat(64);

function evidence() {
  return {
    batch: {
      detectedSheetCount: 2,
      totalSourceRows: 2,
      validRows: 1,
      warningRows: 1,
      errorRows: 0,
      selectedSheetName: "Employees",
    },
    sheets: [
      {
        id: ids.excludedSheet,
        name: "Notes",
        index: 1,
        headerRow: null,
        rowCount: 0,
        columnCount: 0,
        hidden: false,
        selected: false,
        purpose: "excluded",
      },
      {
        id: ids.selectedSheet,
        name: "Employees",
        index: 0,
        headerRow: 1,
        rowCount: 2,
        columnCount: 3,
        hidden: false,
        selected: true,
        purpose: "employee_master",
      },
    ],
    fieldMappings: [
      {
        sheetId: ids.selectedSheet,
        sourceColumnName: "Employee No",
        sourceColumnIndex: 0,
        targetField: "employee_number",
        transformationRule: { trim: true, preserveText: true },
        isRequired: true,
      },
    ],
    sourceRows: [
      sourceRow(ids.secondRow, 3, "E-002", "warning"),
      sourceRow(ids.firstRow, 2, "E-001", "staged"),
    ],
    issues: [
      {
        sourceRowId: ids.secondRow,
        issueType: "missing_name",
        severity: "warning",
        message: "Name is missing",
      },
    ],
    sourceLabels: [
      {
        resolutionType: "department",
        sourceLabel: " Front Desk ",
        normalizedSourceLabel: "front desk",
        sourceSheet: "Employees",
        affectedRowCount: 2,
      },
    ],
  };
}

function sourceRow(id, sourceRowNumber, employeeNumber, processingStatus) {
  return {
    id,
    sheetId: ids.selectedSheet,
    sourceRowNumber,
    rawValues: [
      {
        sourceColumnIndex: 0,
        sourceColumnName: "Employee No",
        targetField: "employee_number",
        value: employeeNumber,
      },
    ],
    normalizedValues: {
      employee_number: employeeNumber,
      department_source_label: "Front Desk",
    },
    rowFingerprint: computeImportSourceRowFingerprint([
      {
        sourceColumnIndex: 0,
        sourceColumnName: "Employee No",
        targetField: "employee_number",
        value: employeeNumber,
      },
    ]),
    processingStatus,
    proposedAction: "unresolved",
    validationSummary: { blockingIssues: [], warningIssues: [] },
  };
}

function createDatabase(calls, failAt = -1) {
  let invocation = 0;
  return {
    async query(text, values) {
      calls.push({ text: String(text).replace(/\s+/g, " ").trim(), values });
      invocation += 1;
      if (invocation === failAt) throw new Error("database-failure");
      if (String(text).includes("begin_neon_import_staging")) {
        return { rows: [{ payload: sagaPayload("verified", "inspecting", "passed", 7) }] };
      }
      if (String(text).includes("finalize_neon_import_staging")) {
        return { rows: [{ payload: sagaPayload("linked", "mapping_required", "passed", 8) }] };
      }
      return { rows: [] };
    },
  };
}

function sagaPayload(storage, workbook, verification, version) {
  return {
    batch_id: ids.batch,
    storage_lifecycle: storage,
    workbook_lifecycle: workbook,
    verification_status: verification,
    version,
  };
}

function repository(database) {
  return createNeonImportStagingRepository(
    database,
    "hotel.example.test",
    { tenantId: ids.tenant, propertyId: ids.property },
  );
}

test("staging validates all evidence before issuing the begin statement", async () => {
  const calls = [];
  const input = evidence();
  input.sourceRows[0] = { ...input.sourceRows[0], rowFingerprint: "invalid" };

  await assert.rejects(
    repository(createDatabase(calls)).stageVerifiedWorkbook({
      batchId: ids.batch,
      expectedVersion: 7,
      evidence: input,
    }),
    /NEON_IMPORT_STAGING_PAYLOAD_INVALID:sourceRows\.0\.rowFingerprint/,
  );
  assert.equal(calls.length, 0);
});

test("staging sends deterministic bounded chunks in mapping-before-row order", async () => {
  const calls = [];
  const result = await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: evidence(),
  });

  assert.equal(result.storageLifecycle, "linked");
  assert.deepEqual(
    calls.map(call => call.text.match(/public\.([a-z_]+)/)?.[1]),
    [
      "begin_neon_import_staging",
      "append_neon_import_sheets",
      "append_neon_import_field_mappings",
      "append_neon_import_source_rows",
      "append_neon_import_issues",
      "append_neon_import_source_labels",
      "finalize_neon_import_staging",
    ],
  );
  const rowChunk = JSON.parse(calls[3].values[2]);
  assert.deepEqual(rowChunk.map(row => row.id), [ids.firstRow, ids.secondRow]);
  assert.ok(new TextEncoder().encode(calls[3].values[2]).byteLength <= 1024 * 1024);
});

test("staging splits issue evidence at the fixed record and byte budgets", async () => {
  const calls = [];
  const input = evidence();
  input.issues = Array.from({ length: 251 }, (_, index) => ({
    sourceRowId: ids.firstRow,
    issueType: `issue_${index}`,
    severity: "warning",
    message: `bounded issue ${index}`,
  }));

  await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: input,
  });

  const issueChunks = calls.filter(call => call.text.includes("append_neon_import_issues"));
  assert.deepEqual(issueChunks.map(call => JSON.parse(call.values[2]).length), [250, 1]);
  assert.equal(issueChunks.every(call => new TextEncoder().encode(call.values[2]).byteLength <= 512 * 1024), true);
});

test("staging rejects a single oversize source record before SQL", async () => {
  const calls = [];
  const input = evidence();
  const oversizedRawValues = [{
    sourceColumnIndex: 0,
    sourceColumnName: "Employee No",
    targetField: "employee_number",
    value: "x".repeat(1024 * 1024),
  }];
  input.sourceRows[0] = {
    ...input.sourceRows[0],
    rawValues: oversizedRawValues,
    rowFingerprint: computeImportSourceRowFingerprint(oversizedRawValues),
  };

  await assert.rejects(
    repository(createDatabase(calls)).stageVerifiedWorkbook({
      batchId: ids.batch,
      expectedVersion: 7,
      evidence: input,
    }),
    /E5B_IMPORT_STAGING_RECORD_TOO_LARGE/,
  );
  assert.equal(calls.length, 0);
});

test("staging propagates a chunk SQL error without issuing a finalizer", async () => {
  const calls = [];
  await assert.rejects(
    repository(createDatabase(calls, 3)).stageVerifiedWorkbook({
      batchId: ids.batch,
      expectedVersion: 7,
      evidence: evidence(),
    }),
    /database-failure/,
  );
  assert.equal(calls.some(call => call.text.includes("finalize_neon_import_staging")), false);
});

test("staging query surface is an explicit entrypoint allowlist", () => {
  assert.deepEqual(
    APPROVED_IMPORT_STAGING_ENTRYPOINTS,
    [
      "begin_neon_import_staging",
      "append_neon_import_sheets",
      "append_neon_import_field_mappings",
      "append_neon_import_source_rows",
      "append_neon_import_issues",
      "append_neon_import_source_labels",
      "finalize_neon_import_staging",
      "create_neon_import_upload_intent",
      "record_neon_import_object_uploaded",
      "record_neon_import_object_verification",
      "mark_neon_import_cleanup_pending",
      "claim_neon_import_cleanup",
      "complete_neon_import_cleanup",
      "fail_neon_import_cleanup",
      "get_neon_import_workflow",
      "list_neon_import_history",
    ],
  );
});

test("repository source validation rejects raw table access and dynamic entrypoints", async () => {
  const source = await readFile(
    new URL("../../app/repositories/neon/import-staging-repository.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotThrow(() => validateE5bImportStagingRepositorySource(source));
  assert.throws(
    () => validateE5bImportStagingRepositorySource(
      source.replace(
        "select public.get_neon_import_workflow($1::text,$2::uuid) as payload",
        "select * from public.import_batches",
      ),
    ),
    /E5B_IMPORT_STAGING_REPOSITORY_ENTRYPOINT_MISSING|E5B_IMPORT_STAGING_REPOSITORY_BOUNDARY_VIOLATION/,
  );
});
