import assert from "node:assert/strict";
import test, { mock } from "node:test";

const fullChecksum = "a".repeat(64);
const accidentalChecksum = "b".repeat(64);
const insertedBatches = [];

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

const admin = {
  from(table) {
    return {
      async insert(values) {
        if (table === "import_batches") insertedBatches.push(values);
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
  storage: {
    from() {
      return {
        async upload() {
          return { error: null };
        },
        async remove() {
          return { error: null };
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
    }],
  },
  sourceRows: [],
  fieldMappings: [],
  sourceLabels: {
    departments: [],
    positions: [],
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
    sourceRows: 0,
    structurallyValid: 0,
    blockedRows: 0,
    warningRows: 0,
    uniqueDepartmentLabels: 0,
    uniquePositionLabels: 0,
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

mock.module(new URL("../app/lib/supabase/server-admin.ts", import.meta.url), {
  namedExports: {
    createServerAdminClient: () => admin,
  },
});

class MockAuthorizationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

mock.module(new URL("../app/services/production-authorization.ts", import.meta.url), {
  namedExports: {
    AuthorizationError: MockAuthorizationError,
    requireProductionPropertyManager: async () => ({
      authUserId: "00000000-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000002",
      propertyId: "00000000-0000-4000-8000-000000000003",
      refreshedCookies: [],
    }),
  },
});

mock.module(new URL("../app/services/import/production-workbook-staging.ts", import.meta.url), {
  namedExports: {
    prepareEmployeeMasterStaging: () => prepared,
  },
});

const { POST } = await import("../app/api/import/inspect/route.ts");

test("Recovery C import API serializes an allowlisted browser response without full checksums", async () => {
  const form = new FormData();
  form.set("file", new File(
    [new Uint8Array([1, 2, 3])],
    "synthetic-recovery-c.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  ));

  const response = await POST(new Request("https://ktsz.ldchub.cn/api/import/inspect", {
    method: "POST",
    body: form,
  }));
  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 201);
  assert.equal(insertedBatches[0].file_checksum, fullChecksum);
  assert.equal(body.checksumPrefix, fullChecksum.slice(0, 12));
  assert.equal(body.inspection, undefined);
  assert.equal(body.accidentalChecksum, undefined);
  assert.doesNotMatch(serialized, /[0-9a-f]{64}/i);
});
