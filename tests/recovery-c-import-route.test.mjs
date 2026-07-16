import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { AuthorizationError } from "../app/services/production-authorization.ts";

const fullChecksum = "a".repeat(64);
const accidentalChecksum = "b".repeat(64);
const actorCalls = {
  accessTokens: [],
  directTables: [],
  events: [],
  uploads: [],
  removals: [],
  rpcs: [],
};
let authorizationMode = "manager";
let rpcFailure = null;
let uploadFailure = null;
let removalFailuresRemaining = 0;

function resetState() {
  authorizationMode = "manager";
  rpcFailure = null;
  uploadFailure = null;
  removalFailuresRemaining = 0;
  for (const value of Object.values(actorCalls)) value.length = 0;
}

function successfulQuery() {
  const query = {
    eq() {
      return query;
    },
    then(resolve, reject) {
      return Promise.resolve({ error: null }).then(resolve, reject);
    },
  };
  return query;
}

const actorClient = {
  from(table) {
    actorCalls.directTables.push(table);
    return {
      async insert() {
        return { error: null };
      },
      update() {
        return successfulQuery();
      },
      delete() {
        return successfulQuery();
      },
    };
  },
  async rpc(name, params) {
    actorCalls.events.push(`rpc:${name}`);
    actorCalls.rpcs.push({ name, params });
    return rpcFailure
      ? { data: null, error: rpcFailure }
      : {
          data: {
            batchId: params.p_batch_id,
            status: "mapping_required",
            version: 1,
          },
          error: null,
        };
  },
  storage: {
    from(bucket) {
      return {
        async upload(path, bytes, options) {
          actorCalls.events.push(`upload:${path}`);
          actorCalls.uploads.push({ bucket, path, bytes, options });
          return { error: uploadFailure };
        },
        async remove(paths) {
          actorCalls.events.push(`remove:${paths.join(",")}`);
          actorCalls.removals.push({ bucket, paths });
          if (removalFailuresRemaining > 0) {
            removalFailuresRemaining -= 1;
            return {
              data: null,
              error: {
                code: "storage_cleanup_failure",
                message: "synthetic cleanup failure",
              },
            };
          }
          return {
            data: paths.map(name => ({ name })),
            error: null,
          };
        },
      };
    },
  },
};

const prepared = {
  inspection: {
    checksum: fullChecksum,
    sheets: [{
      name: "Sheet1",
      index: 0,
      likelyHeaderRow: 3,
      rowCount: 4,
    }],
  },
  sourceRows: [{
    id: "83000000-0000-0000-0000-000000000401",
    sourceRowNumber: 4,
    rawValues: {
      Empid: "0007",
      CName: "示例员工",
      Department: "Front Office",
      Position: "Guest Service Associate",
    },
    normalizedValues: {
      employee_number: "0007",
      name_zh: "示例员工",
      department_source_label: "Front Office",
      position_source_label: "Guest Service Associate",
    },
    rowFingerprint: "synthetic-row-fingerprint",
    processingStatus: "warning",
    proposedAction: "unresolved",
    validationSummary: {
      blockingIssues: [],
      warningIssues: ["invalid_date"],
    },
  }],
  fieldMappings: [{
    sourceColumnName: "Empid",
    sourceColumnIndex: 0,
    targetField: "employee_number",
    transformationRule: { preserveLeadingZeros: true },
    isRequired: true,
  }],
  sourceLabels: {
    departments: [{
      sourceValue: "Front Office",
      normalizedSourceValue: "front office",
      sourceSheet: "Sheet1",
      sourceRowCount: 1,
    }],
    positions: [{
      sourceValue: "Guest Service Associate",
      normalizedSourceValue: "guest service associate",
      sourceSheet: "Sheet1",
      sourceRowCount: 1,
    }],
  },
  safeSummary: {
    sanitizedFilename: "synthetic-recovery-c.xlsx",
    checksumPrefix: fullChecksum.slice(0, 12),
    sizeBytes: 256,
    detectedSheets: [{
      name: "Sheet1",
      rowCount: 4,
      columnCount: 8,
      hidden: false,
    }],
    selectedSheet: "Sheet1",
    headerRow: 3,
    sourceRows: 1,
    structurallyValid: 1,
    blockedRows: 0,
    warningRows: 1,
    uniqueDepartmentLabels: 1,
    uniquePositionLabels: 1,
    exclusions: {
      totalColumns: 0,
      formulaDerivedColumns: 0,
      trainingHistoryAndSensitiveColumns: 0,
      genderExcludedByDefault: false,
      trainingHistoryExcluded: true,
      ctcGtcExcluded: true,
    },
    excludedColumns: [],
    excludedSheets: [],
    warnings: [],
    employeesImported: 0,
    trainingHistoryImported: false,
    ctcGtcImported: false,
    inspection: {
      checksum: fullChecksum,
    },
    accidentalChecksum,
  },
};

const routeModule = await import("../app/api/import/inspect/route.ts");

function createHandler() {
  assert.equal(
    typeof routeModule.createImportInspectionHandler,
    "function",
    "route must export an injectable actor-scoped handler",
  );
  return routeModule.createImportInspectionHandler({
    authorize: async () => {
      if (authorizationMode === "department") {
        throw new AuthorizationError(403, "仅酒店学习与发展经理可更新员工资料");
      }
      if (authorizationMode === "disabled") {
        throw new AuthorizationError(403, "当前账号已停用");
      }
      return {
        authUserId: "00000000-0000-4000-8000-000000000001",
        tenantId: "00000000-0000-4000-8000-000000000002",
        propertyId: "00000000-0000-4000-8000-000000000003",
        hostname: "ktsz.ldchub.cn",
        accessToken: "manager-access-token",
        refreshedCookies: [],
      };
    },
    actorClient: accessToken => {
      actorCalls.accessTokens.push(accessToken);
      return actorClient;
    },
    prepare: () => prepared,
    randomUUID: () => "81000000-0000-4000-8000-000000000401",
  });
}

function importRequest() {
  const form = new FormData();
  form.set("file", new File(
    [new Uint8Array([1, 2, 3])],
    "synthetic-recovery-c.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ));
  return new Request("https://ktsz.ldchub.cn/api/import/inspect", {
    method: "POST",
    body: form,
  });
}

test("Recovery C staging source uses only the authenticated actor client and server property context", async () => {
  const [route, authorization, serverClient] = await Promise.all([
    readFile(new URL("../app/api/import/inspect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/services/production-authorization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/supabase/server-admin.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /createServerActorClient/);
  assert.match(route, /stage_employee_import/);
  assert.match(route, /property-import-files/);
  assert.doesNotMatch(route, /createServerAdminClient/);
  assert.doesNotMatch(route, /form\.get\(["']propertyId["']\)/);
  assert.doesNotMatch(route, /\.from\(["'](?:import_batches|import_sheets|import_field_mappings|import_source_rows|import_issues|department_aliases|position_aliases)["']\)/);
  assert.match(authorization, /createServerActorClient\(resolved\.accessToken\)/);
  assert.doesNotMatch(authorization, /createServerAdminClient/);
  assert.match(serverClient, /const token = accessToken\.trim\(\)/);
  assert.match(serverClient, /Authorization:\s*`Bearer \$\{token\}`/);
});

test("authenticated manager uploads privately, stages atomically, and receives only allowlisted aggregate evidence", async () => {
  resetState();
  const response = await createHandler()(importRequest());
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 201);
  assert.deepEqual(actorCalls.accessTokens, ["manager-access-token"]);
  assert.equal(actorCalls.uploads.length, 1);
  assert.equal(actorCalls.uploads[0].bucket, "property-import-files");
  assert.equal(actorCalls.uploads[0].options.upsert, false);
  assert.equal(actorCalls.rpcs.length, 1);
  assert.equal(actorCalls.rpcs[0].name, "stage_employee_import");
  assert.equal(actorCalls.rpcs[0].params.p_property_id, "00000000-0000-4000-8000-000000000003");
  assert.equal(actorCalls.rpcs[0].params.p_staging.batch.fileChecksum, fullChecksum);
  assert.equal(actorCalls.rpcs[0].params.p_staging.rows[0].normalizedValues.employee_number, "0007");
  assert.equal(actorCalls.rpcs[0].params.p_staging.sourceLabels.length, 2);
  assert.deepEqual(actorCalls.events, [
    `upload:${actorCalls.uploads[0].path}`,
    "rpc:stage_employee_import",
  ]);
  assert.deepEqual(actorCalls.directTables, []);
  assert.equal(body.checksumPrefix, fullChecksum.slice(0, 12));
  assert.equal(body.inspection, undefined);
  assert.equal(body.accidentalChecksum, undefined);
  assert.doesNotMatch(serialized, /[0-9a-f]{64}/i);
});

test("department and disabled accounts are denied before creating a data client or writing Storage", async () => {
  for (const mode of ["department", "disabled"]) {
    resetState();
    authorizationMode = mode;
    const response = await createHandler()(importRequest());
    assert.equal(response.status, 403, mode);
    assert.deepEqual(actorCalls.accessTokens, [], mode);
    assert.deepEqual(actorCalls.uploads, [], mode);
    assert.deepEqual(actorCalls.rpcs, [], mode);
  }
});

test("an atomic staging failure removes only the just-uploaded private object and leaves no direct partial writes", async () => {
  resetState();
  rpcFailure = { code: "23514", message: "synthetic staging failure" };

  const response = await createHandler()(importRequest());
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.message, "工作簿暂存失败，请重试");
  assert.equal(actorCalls.rpcs.length, 1);
  assert.equal(actorCalls.removals.length, 1);
  assert.deepEqual(actorCalls.removals[0], {
    bucket: "property-import-files",
    paths: [actorCalls.uploads[0].path],
  });
  assert.deepEqual(actorCalls.events, [
    `upload:${actorCalls.uploads[0].path}`,
    "rpc:stage_employee_import",
    `remove:${actorCalls.uploads[0].path}`,
  ]);
  assert.deepEqual(actorCalls.directTables, []);
});

test("a failed private upload never calls the database staging RPC or attempts object deletion", async () => {
  resetState();
  uploadFailure = { code: "storage_failure", message: "synthetic upload failure" };

  const response = await createHandler()(importRequest());

  assert.equal(response.status, 422);
  assert.deepEqual(actorCalls.rpcs, []);
  assert.deepEqual(actorCalls.removals, []);
});

test("cleanup retries once and preserves the ordinary staging failure when the exact second removal succeeds", async () => {
  resetState();
  rpcFailure = { code: "23514", message: "synthetic staging failure" };
  removalFailuresRemaining = 1;

  const response = await createHandler()(importRequest());
  const body = await response.json();

  assert.equal(response.status, 422);
  assert.equal(body.message, "工作簿暂存失败，请重试");
  assert.equal(actorCalls.removals.length, 2);
  assert.deepEqual(
    actorCalls.removals.map(call => call.paths),
    [
      [actorCalls.uploads[0].path],
      [actorCalls.uploads[0].path],
    ],
  );
});

test("exhausted exact-path cleanup returns a distinct aggregate-only failure without leaking object or row evidence", async () => {
  resetState();
  rpcFailure = { code: "23514", message: "synthetic staging failure" };
  removalFailuresRemaining = 2;

  const response = await createHandler()(importRequest());
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 500);
  assert.equal(
    body.message,
    "工作簿暂存失败，临时文件清理未完成，请联系管理员",
  );
  assert.equal(actorCalls.removals.length, 2);
  assert.doesNotMatch(serialized, /synthetic-recovery-c\.xlsx/);
  assert.doesNotMatch(serialized, /0007|示例员工|Front Office/);
  assert.doesNotMatch(serialized, /[0-9a-f]{64}/i);
  assert.doesNotMatch(
    serialized,
    /00000000-0000-4000-8000-00000000000[23]/,
  );
});
