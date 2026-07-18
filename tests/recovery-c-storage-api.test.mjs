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
const managerAccountId = crypto.randomUUID();
const WORKBOOK_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const workbookBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

const local = localSupabaseStatus();
removeLocalImportGraphsByFilename("linked-evidence.xlsx");
const originalLocalManagerAccounts = localManagerAccounts();
installLocalManagerAccount();
after(() => {
  try {
    assert.deepEqual(localImportGraphCountsByFilename("linked-evidence.xlsx"), {
      batches: 0,
      sheets: 0,
      activityEvents: 0,
    });
  } finally {
    restoreLocalManagerAccounts(originalLocalManagerAccounts);
  }
  assert.deepEqual(localManagerAccounts(), originalLocalManagerAccounts);
});
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
    let storageCleanupError;
    try {
      const cleanup = await service.storage.from(BUCKET).remove([objectPath]);
      assert.equal(cleanup.error, null, cleanup.error?.message);
      const absence = await service.storage.from(BUCKET).exists(objectPath);
      assert.equal(absence.data, false);
    } catch (error) {
      storageCleanupError = error;
    }
    removeLocalImportGraph(batchId);
    assert.deepEqual(localImportGraphCounts(batchId), {
      batches: 0,
      sheets: 0,
      activityEvents: 0,
    });
    if (storageCleanupError) throw storageCleanupError;
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

function installLocalManagerAccount() {
  runLocalSql(`
    begin;
    delete from public.user_accounts
    where property_id = '${MANAGER_PROPERTY_ID}'
      and auth_user_id = '${MANAGER_USER_ID}';
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
      '${managerAccountId}',
      '${MANAGER_USER_ID}',
      '${MANAGER_USER_ID}',
      '${TENANT_ID}',
      '${MANAGER_PROPERTY_ID}',
      'storage-integration-manager-${managerAccountId.slice(0, 8)}',
      'active',
      false,
      null
    );
    commit;
  `);
}

function restoreLocalManagerAccounts(originalAccounts) {
  const originalJson = sqlString(JSON.stringify(originalAccounts));
  runLocalSql(`
    begin;
    delete from public.user_accounts
    where property_id = '${MANAGER_PROPERTY_ID}'
      and auth_user_id = '${MANAGER_USER_ID}';
    insert into public.user_accounts (
      id,
      user_id,
      auth_user_id,
      tenant_id,
      property_id,
      employee_id,
      login_id,
      account_status,
      must_change_password,
      failed_login_count,
      locked_until,
      last_login_at,
      created_at,
      updated_at,
      created_by,
      updated_by,
      version
    )
    select
      restored.id,
      restored.user_id,
      restored.auth_user_id,
      restored.tenant_id,
      restored.property_id,
      restored.employee_id,
      restored.login_id,
      restored.account_status,
      restored.must_change_password,
      restored.failed_login_count,
      restored.locked_until,
      restored.last_login_at,
      restored.created_at,
      restored.updated_at,
      restored.created_by,
      restored.updated_by,
      restored.version
    from jsonb_populate_recordset(
      null::public.user_accounts,
      ${originalJson}::jsonb
    ) restored;
    commit;
  `);
}

function localManagerAccounts() {
  return JSON.parse(runLocalSql(`
    select coalesce(
      jsonb_agg(to_jsonb(account) order by account.id),
      '[]'::jsonb
    )::text
    from public.user_accounts account
    where account.property_id = '${MANAGER_PROPERTY_ID}'
      and account.auth_user_id = '${MANAGER_USER_ID}';
  `));
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
  return execFileSync(
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
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      encoding: "utf8",
      input: sql,
    },
  ).trim();
}

function localImportGraphCounts(batchId) {
  return JSON.parse(runLocalSql(`
    select json_build_object(
      'batches',
      (select count(*) from public.import_batches where id = '${batchId}'),
      'sheets',
      (select count(*) from public.import_sheets
       where import_batch_id = '${batchId}'),
      'activityEvents',
      (select count(*) from public.import_activity_events
       where import_batch_id = '${batchId}')
    )::text;
  `));
}

function localImportGraphCountsByFilename(filename) {
  const filenameLiteral = sqlString(filename);
  return JSON.parse(runLocalSql(`
    select json_build_object(
      'batches',
      (select count(*) from public.import_batches
       where property_id = '${MANAGER_PROPERTY_ID}'
         and original_filename = ${filenameLiteral}),
      'sheets',
      (select count(*)
       from public.import_sheets sheet
       join public.import_batches batch
         on batch.id = sheet.import_batch_id
       where batch.property_id = '${MANAGER_PROPERTY_ID}'
         and batch.original_filename = ${filenameLiteral}),
      'activityEvents',
      (select count(*)
       from public.import_activity_events activity
       join public.import_batches batch
         on batch.id = activity.import_batch_id
       where batch.property_id = '${MANAGER_PROPERTY_ID}'
         and batch.original_filename = ${filenameLiteral})
    )::text;
  `));
}

function removeLocalImportGraph(batchId) {
  runLocalSql(`
    begin;
    set local session_replication_role = replica;
    delete from public.import_activity_events
    where import_batch_id = '${batchId}'
      and property_id = '${MANAGER_PROPERTY_ID}';
    set local session_replication_role = origin;
    delete from public.import_batches
    where id = '${batchId}'
      and property_id = '${MANAGER_PROPERTY_ID}'
      and original_filename = 'linked-evidence.xlsx';
    commit;
  `);
}

function removeLocalImportGraphsByFilename(filename) {
  const filenameLiteral = sqlString(filename);
  runLocalSql(`
    begin;
    set local session_replication_role = replica;
    delete from public.import_activity_events
    where import_batch_id in (
      select id
      from public.import_batches
      where property_id = '${MANAGER_PROPERTY_ID}'
        and original_filename = ${filenameLiteral}
    );
    set local session_replication_role = origin;
    delete from public.import_batches
    where property_id = '${MANAGER_PROPERTY_ID}'
      and original_filename = ${filenameLiteral};
    commit;
  `);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
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
