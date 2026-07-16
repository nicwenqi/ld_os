import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import test, { after } from "node:test";

import { createClient } from "@supabase/supabase-js";

const BUCKET = "property-import-files";
const TENANT_ID = "10000000-0000-0000-0000-000000000001";
const MANAGER_PROPERTY_ID = "20000000-0000-0000-0000-000000000011";
const OTHER_PROPERTY_ID = "20000000-0000-0000-0000-000000000012";
const MANAGER_USER_ID = "00000000-0000-0000-0000-000000000103";
const WORKBOOK_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const workbookBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const local = localSupabaseStatus();
ensureLocalManagerAccount();
after(() => removeLocalManagerAccount());
const clientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};

test("real Storage API lets the manager upload and exactly remove an unlinked failed-staging object", async () => {
  const { manager, service } = await localClients();
  const batchId = crypto.randomUUID();
  const objectPath = importPath(
    MANAGER_PROPERTY_ID,
    batchId,
    "failed-staging.xlsx",
  );

  const upload = await manager.storage
    .from(BUCKET)
    .upload(objectPath, workbookBytes, {
      contentType: WORKBOOK_MIME,
      upsert: false,
    });
  assert.equal(upload.error, null, upload.error?.message);

  const failedStaging = await manager.rpc("stage_employee_import", {
    p_property_id: MANAGER_PROPERTY_ID,
    p_batch_id: batchId,
    p_staging: {},
  });
  assert.ok(failedStaging.error, "synthetic invalid staging must fail");

  const removal = await manager.storage.from(BUCKET).remove([objectPath]);
  assert.equal(removal.error, null, removal.error?.message);
  assert.equal(removal.data?.length, 1);
  assert.equal(removal.data?.[0]?.name, objectPath);

  const absence = await service.storage.from(BUCKET).exists(objectPath);
  assert.equal(absence.data, false);
});

test("real Storage API denies the manager a cross-property pre-staging upload", async () => {
  const { manager, service } = await localClients();
  const objectPath = importPath(
    OTHER_PROPERTY_ID,
    crypto.randomUUID(),
    "cross-property.xlsx",
  );

  const upload = await manager.storage
    .from(BUCKET)
    .upload(objectPath, workbookBytes, {
      contentType: WORKBOOK_MIME,
      upsert: false,
    });
  assert.ok(upload.error, "cross-property upload must be denied");

  const absence = await service.storage.from(BUCKET).exists(objectPath);
  assert.equal(absence.data, false);
});

test("real Storage API keeps a successfully linked workbook immutable", async () => {
  const { manager, service } = await localClients();
  const batchId = crypto.randomUUID();
  const objectPath = importPath(
    MANAGER_PROPERTY_ID,
    batchId,
    "linked-evidence.xlsx",
  );

  try {
    const upload = await manager.storage
      .from(BUCKET)
      .upload(objectPath, workbookBytes, {
        contentType: WORKBOOK_MIME,
        upsert: false,
      });
    assert.equal(upload.error, null, upload.error?.message);

    const staging = await manager.rpc("stage_employee_import", {
      p_property_id: MANAGER_PROPERTY_ID,
      p_batch_id: batchId,
      p_staging: validEmptyStaging(objectPath),
    });
    assert.equal(staging.error, null, staging.error?.message);

    const removal = await manager.storage.from(BUCKET).remove([objectPath]);
    assert.equal(
      removal.data?.some(item => item.name === objectPath) ?? false,
      false,
      "linked workbook evidence must not be reported as removed",
    );

    const presence = await service.storage.from(BUCKET).exists(objectPath);
    assert.equal(presence.error, null, presence.error?.message);
    assert.equal(presence.data, true);
  } finally {
    const cleanup = await service.storage.from(BUCKET).remove([objectPath]);
    assert.equal(cleanup.error, null, cleanup.error?.message);
    const absence = await service.storage.from(BUCKET).exists(objectPath);
    assert.equal(absence.data, false);
  }
});

async function localClients() {
  const managerToken = localJwt(MANAGER_USER_ID);
  const manager = createClient(
    local.API_URL,
    local.PUBLISHABLE_KEY ?? local.ANON_KEY,
    {
      ...clientOptions,
      global: {
        headers: { Authorization: `Bearer ${managerToken}` },
      },
    },
  );
  const service = createClient(
    local.API_URL,
    local.SERVICE_ROLE_KEY,
    clientOptions,
  );
  return { manager, service };
}

function localSupabaseStatus() {
  const status = JSON.parse(
    execFileSync(
      "npx",
      ["--no-install", "supabase", "status", "--output", "json"],
      { encoding: "utf8" },
    ),
  );
  const hostname = new URL(status.API_URL).hostname;
  assert.ok(
    hostname === "127.0.0.1" || hostname === "localhost",
    "Storage integration tests are local-only",
  );
  return status;
}

function ensureLocalManagerAccount() {
  runLocalSql(`
    insert into public.user_accounts (
      id,
      user_id,
      auth_user_id,
      tenant_id,
      property_id,
      login_id,
      account_status,
      must_change_password,
      locked_until
    )
    values (
      '70000000-0000-0000-0000-000000000153',
      '${MANAGER_USER_ID}',
      '${MANAGER_USER_ID}',
      '${TENANT_ID}',
      '${MANAGER_PROPERTY_ID}',
      'storage-integration-manager',
      'active',
      false,
      null
    )
    on conflict (property_id, auth_user_id)
    do update set
      account_status = 'active',
      must_change_password = false,
      locked_until = null;
  `);
}

function removeLocalManagerAccount() {
  runLocalSql(`
    delete from public.user_accounts
    where id = '70000000-0000-0000-0000-000000000153';
  `);
}

function runLocalSql(sql) {
  const databasePort = new URL(local.DB_URL).port;
  const container = execFileSync(
    "docker",
    [
      "ps",
      "--filter",
      `publish=${databasePort}`,
      "--format",
      "{{.Names}}",
    ],
    { encoding: "utf8" },
  ).trim();
  assert.match(container, /^supabase_db_/, "local Supabase DB container required");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      encoding: "utf8",
      input: sql,
    },
  );
}

function importPath(propertyId, batchId, filename) {
  return `${TENANT_ID}/${propertyId}/imports/${batchId}/${filename}`;
}

function localJwt(subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url({ alg: "HS256", typ: "JWT" });
  const payload = base64url({
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    iss: "supabase-demo",
    role: "authenticated",
    sub: subject,
  });
  const signature = createHmac("sha256", local.JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function validEmptyStaging(storageObjectPath) {
  const filename = storageObjectPath.split("/").at(-1);
  return {
    batch: {
      originalFilename: filename,
      sanitizedFilename: filename,
      storageObjectPath,
      fileChecksum: "a".repeat(64),
      fileSizeBytes: workbookBytes.byteLength,
      mimeType: WORKBOOK_MIME,
      detectedSheetCount: 1,
      totalSourceRows: 0,
      validRows: 0,
      warningRows: 0,
      errorRows: 0,
    },
    sheets: [{
      id: crypto.randomUUID(),
      name: "Employee Master",
      index: 0,
      headerRow: 1,
      rowCount: 1,
      selected: true,
      purpose: "employee_master",
    }],
    fieldMappings: [],
    rows: [],
    issues: [],
    sourceLabels: [],
  };
}
