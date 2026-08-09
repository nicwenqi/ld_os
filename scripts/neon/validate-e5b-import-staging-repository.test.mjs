import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

test("finalize manifest hashes only the 092 authoritative evidence projections", async () => {
  const calls = [];
  await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: evidence(),
  });

  const manifest = JSON.parse(calls.at(-1).values[3]);
  const mapping = JSON.parse(calls[2].values[2])[0];
  const issue = JSON.parse(calls[4].values[2])[0];
  const label = JSON.parse(calls[5].values[2])[0];
  assert.equal(
    manifest.fieldMappings[0],
    postgresProjectionHash({
      sheetId: mapping.sheetId,
      sourceColumnName: mapping.sourceColumnName,
      sourceColumnIndex: mapping.sourceColumnIndex,
      targetField: mapping.targetField,
      transformationRule: mapping.transformationRule,
      isRequired: mapping.isRequired,
      mappingStatus: "suggested",
    }),
  );
  assert.equal(
    manifest.issues[0],
    postgresProjectionHash({
      sourceRowId: issue.sourceRowId,
      issueType: issue.issueType,
      severity: issue.severity,
      sourceField: null,
      sourceValueProjection: null,
      message: issue.message,
      resolutionStatus: "open",
    }),
  );
  assert.equal(
    manifest.sourceLabels[0],
    postgresProjectionHash({
      sheetId: ids.selectedSheet,
      resolutionType: label.resolutionType,
      sourceLabel: label.sourceLabel,
      normalizedSourceLabel: label.normalizedSourceLabel,
      affectedRowCount: label.affectedRowCount,
      resolutionStatus: "pending",
    }),
  );
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

test("staging deterministically splits byte-heavy issue evidence without trusting JSON text length", async () => {
  const calls = [];
  const input = evidence();
  input.issues = Array.from({ length: 250 }, (_, index) => ({
    sourceRowId: ids.firstRow,
    issueType: `emoji_${index}`,
    severity: "warning",
    message: "🙂".repeat(1_000),
  }));

  await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: input,
  });

  const issueChunks = calls.filter(call => call.text.includes("append_neon_import_issues"));
  assert.ok(issueChunks.length > 1);
  assert.equal(issueChunks.every(call => postgresJsonbUpperBound(JSON.parse(call.values[2])) <= 512 * 1024), true);
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

test("cleanup claims retain batch-set semantics while operation IDs stay server-only", async () => {
  const claimId = "88888888-8888-4888-8888-888888888888";
  const operationId = "99999999-9999-4999-8999-999999999999";
  const calls = [];
  const database = createDatabase(calls);
  database.query = async (text, values) => {
    calls.push({ text: String(text).replace(/\s+/g, " ").trim(), values });
    return {
      rows: [{ payload: {
        claims: [{
          batch_id: ids.batch,
          operation_id: operationId,
          bucket: "property-import-files",
          object_path: `${ids.tenant}/${ids.property}/imports/${ids.batch}/workbook.xlsx`,
          claim_id: claimId,
          attempt_count: 1,
          lease_expires_at: "2026-08-10T00:05:00.000Z",
        }],
      } }],
    };
  };
  const claims = await repository(database).claimDueCleanup({ limit: 2, claimId });
  assert.equal(Array.isArray(claims), true);
  assert.equal(claims[0].operationId, operationId);
  assert.deepEqual(calls[0].values, ["hotel.example.test", null, 2, claimId]);
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
  assert.throws(
    () => validateE5bImportStagingRepositorySource(
      `${source}\nconst { query } = database;`,
    ),
    /E5B_IMPORT_STAGING_REPOSITORY_QUERY_ALLOWLIST_VIOLATION/,
  );
  assert.throws(
    () => validateE5bImportStagingRepositorySource(
      `${source}\nawait database.query("select public.get_neon_import_workflow($1::text,$2::uuid) as payload; select 1", []);`,
    ),
    /E5B_IMPORT_STAGING_REPOSITORY_QUERY_ALLOWLIST_VIOLATION/,
  );
  assert.throws(
    () => validateE5bImportStagingRepositorySource(
      `${source}\nconst raw = database.query; await raw("select 1", []);`,
    ),
    /E5B_IMPORT_STAGING_REPOSITORY_QUERY_ALLOWLIST_VIOLATION/,
  );
  assert.throws(
    () => validateE5bImportStagingRepositorySource(
      `${source}\nconst raw = database.query.call.bind(database); await raw("select 1", []);`,
    ),
    /E5B_IMPORT_STAGING_REPOSITORY_QUERY_ALLOWLIST_VIOLATION/,
  );
  for (const indirect of [
    'await database?.query("select 1", []);',
    'await database["qu" + "ery"]("select 1", []);',
    'const raw = (database).query; await raw("select 1", []);',
    'await database?.["query"]("select 1", []);',
    'await Object.create(database).query("select 1", []);',
    'await Reflect.get(database, "qu" + "ery")("select 1", []);',
    'await new Proxy(database, {}).query?.("select 1", []);',
  ]) {
    assert.throws(
      () => validateE5bImportStagingRepositorySource(`${source}\n${indirect}`),
      /E5B_IMPORT_STAGING_REPOSITORY_QUERY_ALLOWLIST_VIOLATION/,
    );
  }
});

test("source label normalization matches PostgreSQL btrim U+0020 ordering", async () => {
  const calls = [];
  const input = evidence();
  input.sourceLabels[0] = {
    ...input.sourceLabels[0],
    sourceLabel: "\u00a0Front Desk\u00a0",
    normalizedSourceLabel: " front desk ",
  };
  input.sourceRows = input.sourceRows.map(row => ({
    ...row,
    normalizedValues: { ...row.normalizedValues, department_source_label: "\u00a0Front Desk\u00a0" },
  }));

  await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: input,
  });
  const label = JSON.parse(calls[5].values[2])[0];
  assert.equal(label.normalizedSourceLabel, " front desk ");
});

test("source label normalization uses PostgreSQL C-collation ASCII lowercase only", async () => {
  const calls = [];
  const input = evidence();
  input.sourceLabels[0] = {
    ...input.sourceLabels[0],
    sourceLabel: "Ä TEAM",
    normalizedSourceLabel: "Ä team",
  };
  input.sourceRows = input.sourceRows.map(row => ({
    ...row,
    normalizedValues: { ...row.normalizedValues, department_source_label: "Ä TEAM" },
  }));

  await repository(createDatabase(calls)).stageVerifiedWorkbook({
    batchId: ids.batch,
    expectedVersion: 7,
    evidence: input,
  });
  const label = JSON.parse(calls[5].values[2])[0];
  assert.equal(label.normalizedSourceLabel, "Ä team");
});

function postgresProjectionHash(value) {
  const text = postgresJsonbText(value);
  return (awaitableHash(text));
}

function awaitableHash(value) {
  // This fixed fixture invokes the same byte-frame SHA-256 logic as 092.
  return createHashForTest(`e5b-utf8-frame-v1:${new TextEncoder().encode(value).byteLength}:${value}`);
}

function createHashForTest(value) {
  // Node's WebCrypto keeps this test independent from repository internals.
  return createHashForTestSync(value);
}

function createHashForTestSync(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function postgresJsonbText(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  const bytes = new TextEncoder();
  const compare = (left, right) => left.length - right.length || compareBytes(bytes.encode(left), bytes.encode(right));
  return `{${Object.keys(value).sort(compare).map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(", ")}}`;
}

function compareBytes(left, right) {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function postgresJsonbUpperBound(value) {
  return new TextEncoder().encode(postgresJsonbText(value)).byteLength + countJsonNodes(value) * 16 + 64;
}

function countJsonNodes(value) {
  if (value === null || typeof value !== "object") return 1;
  if (Array.isArray(value)) return 1 + value.reduce((total, child) => total + countJsonNodes(child), 0);
  return 1 + Object.values(value).reduce((total, child) => total + countJsonNodes(child), 0);
}
