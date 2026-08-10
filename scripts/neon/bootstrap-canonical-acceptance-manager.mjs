#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

export const CANONICAL_ACCEPTANCE_TARGET = Object.freeze({
  projectId: "delicate-wind-06430851",
  branchId: "br-icy-scene-aukkzv69",
  endpointId: "ep-frosty-math-audxlq88",
  database: "neondb",
  directHostPrefix: "ep-frosty-math-audxlq88.",
  bootstrapRole: "neondb_owner",
  runtimeRole: "hotel_ld_application",
});

export const BOOTSTRAP_CONFIRMATION = "I_UNDERSTAND_STAGING_ONLY";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SAFE_EVIDENCE_ROOTS = ["/private/tmp/", "/tmp/"];

const SQL = Object.freeze({
  tenantExisting: `select id, code, name, status from public.tenants where id = $1 or code = $2 order by id`,
  tenantInsert: `insert into public.tenants (id, code, name, status) values ($1, $2, $3, 'active') on conflict do nothing`,
  propertyExisting: `select id, tenant_id, code, name_zh, name_en, status from public.properties where id = $1 or (tenant_id = $2 and code = $3) order by id`,
  propertyInsert: `insert into public.properties (id, tenant_id, code, name_zh, name_en, country_region, timezone, default_language, status) values ($1, $2, $3, $4, $5, $6, $7, $8, 'active') on conflict do nothing`,
  domainExisting: `select id, tenant_id, property_id, hostname, verification_status, is_active from public.property_domains where id = $1 or hostname = $2 order by id`,
  domainInsert: `insert into public.property_domains (id, tenant_id, property_id, hostname, verification_status, is_active) values ($1, $2, $3, $4, 'verified', true) on conflict do nothing`,
  profileExisting: `select id, display_name, email, is_active from public.profiles where id = $1 order by id`,
  profileInsert: `insert into public.profiles (id, display_name, email, is_active) values ($1, $2, $3, true) on conflict do nothing`,
  accountExisting: `select id, auth_user_id, user_id, tenant_id, property_id, account_status from public.user_accounts where id = $1 or auth_user_id = $2 or user_id = $3 order by id`,
  accountInsert: `insert into public.user_accounts (id, auth_user_id, user_id, tenant_id, property_id, account_status, must_change_password) values ($1, $2, $3, $4, $5, 'active', false) on conflict do nothing`,
  tenantMembershipExisting: `select id, tenant_id, user_id, status from public.tenant_memberships where id = $1 or (tenant_id = $2 and user_id = $3) order by id`,
  tenantMembershipInsert: `insert into public.tenant_memberships (id, tenant_id, user_id, status) values ($1, $2, $3, 'active') on conflict do nothing`,
  propertyMembershipExisting: `select id, tenant_id, property_id, user_id, status from public.property_memberships where id = $1 or (property_id = $2 and user_id = $3) order by id`,
  propertyMembershipInsert: `insert into public.property_memberships (id, tenant_id, property_id, user_id, status) values ($1, $2, $3, $4, 'active') on conflict do nothing`,
  roleExisting: `select id, tenant_id, property_id, code, scope_level, is_active from public.roles where id = $1 or (tenant_id = $2 and property_id = $3 and code = $4) order by id`,
  roleInsert: `insert into public.roles (id, tenant_id, property_id, code, scope_level, is_active) values ($1, $2, $3, 'property_ld_manager', 'property', true) on conflict do nothing`,
  assignmentExisting: `select id, tenant_id, property_id, user_id, role_id, status from public.role_assignments where id = $1 or (tenant_id = $2 and property_id = $3 and user_id = $4 and role_id = $5) order by id`,
  assignmentInsert: `insert into public.role_assignments (id, tenant_id, property_id, user_id, role_id, status) values ($1, $2, $3, $4, $5, 'active') on conflict do nothing`,
  auditInsert: `insert into app_private.organization_write_audit_events (request_id, auth_user_id, actor_user_id, tenant_id, property_id, operation, target_id, details) values ($1, $2, $3, $4, $5, 'acceptance_bootstrap_manager', $6, $7::jsonb)`,
});

function fail(code, details = "") {
  const error = new Error(details ? `${code}: ${details}` : code);
  error.code = code;
  throw error;
}

function assertObject(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("E5E_BOOTSTRAP_INVALID_FIXTURE", `${name} must be an object`);
  return value;
}

function assertExactKeys(value, name, allowed) {
  assertObject(value, name);
  const keys = Object.keys(value).sort();
  const expected = [...allowed].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail("E5E_BOOTSTRAP_INVALID_FIXTURE", `${name} has unexpected fields`);
  }
}

function assertUuid(value, name) {
  if (typeof value !== "string" || !UUID.test(value)) fail("E5E_BOOTSTRAP_INVALID_FIXTURE", `${name} must be a UUID`);
  return value;
}

function assertText(value, name, { lower = false, max = 200 } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value !== value.trim()) {
    fail("E5E_BOOTSTRAP_INVALID_FIXTURE", `${name} must be a non-blank bounded string`);
  }
  if (lower && value !== value.toLowerCase()) fail("E5E_BOOTSTRAP_INVALID_FIXTURE", `${name} must be lowercase`);
  return value;
}

export function validateAcceptanceTarget(env = process.env) {
  if (env.ACCEPTANCE_BOOTSTRAP_CONFIRM !== BOOTSTRAP_CONFIRMATION) fail("E5E_BOOTSTRAP_CONFIRMATION_REQUIRED");
  if (env.NEON_ACCEPTANCE_PROJECT_ID !== CANONICAL_ACCEPTANCE_TARGET.projectId
    || env.NEON_ACCEPTANCE_BRANCH_ID !== CANONICAL_ACCEPTANCE_TARGET.branchId
    || env.NEON_ACCEPTANCE_ENDPOINT_ID !== CANONICAL_ACCEPTANCE_TARGET.endpointId
    || env.NEON_ACCEPTANCE_DATABASE !== CANONICAL_ACCEPTANCE_TARGET.database) {
    fail("E5E_BOOTSTRAP_TARGET_MISMATCH");
  }
  if (env.DATABASE_URL || env.NEON_RUNTIME_DATABASE_URL) fail("E5E_BOOTSTRAP_RUNTIME_URL_FORBIDDEN");
  return true;
}

export function validateBootstrapConnectionString(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length < 20) fail("E5E_BOOTSTRAP_DATABASE_URL_REQUIRED");
  let parsed;
  try { parsed = new URL(connectionString); } catch { fail("E5E_BOOTSTRAP_DATABASE_URL_INVALID"); }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) fail("E5E_BOOTSTRAP_DATABASE_URL_INVALID");
  if (!parsed.hostname.startsWith(CANONICAL_ACCEPTANCE_TARGET.directHostPrefix) || parsed.hostname.includes("-pooler.")) fail("E5E_BOOTSTRAP_ENDPOINT_MISMATCH");
  if (decodeURIComponent(parsed.username) !== CANONICAL_ACCEPTANCE_TARGET.bootstrapRole) fail("E5E_BOOTSTRAP_ROLE_MISMATCH");
  if (parsed.pathname !== `/${CANONICAL_ACCEPTANCE_TARGET.database}`) fail("E5E_BOOTSTRAP_DATABASE_MISMATCH");
  const queryKeys = [...parsed.searchParams.keys()];
  if (queryKeys.some((key) => !["sslmode", "channel_binding"].includes(key))) fail("E5E_BOOTSTRAP_URL_QUERY_FORBIDDEN");
  if (parsed.searchParams.get("sslmode") !== "require" || (parsed.searchParams.has("channel_binding") && parsed.searchParams.get("channel_binding") !== "require")) fail("E5E_BOOTSTRAP_SSL_REQUIRED");
  return parsed;
}

export function validateAcceptanceFixture(fixture) {
  assertExactKeys(fixture, "fixture", ["authUserId", "tenant", "property", "propertyDomain", "profile", "userAccount", "tenantMembership", "propertyMembership", "role", "roleAssignment"]);
  assertUuid(fixture.authUserId, "authUserId");
  for (const [key, allowed] of [
    ["tenant", ["id", "code", "name"]],
    ["property", ["id", "code", "nameZh", "nameEn", "countryRegion", "timezone", "defaultLanguage"]],
    ["propertyDomain", ["id", "hostname"]],
    ["profile", ["id", "displayName", "email"]],
    ["userAccount", ["id", "loginId"]],
    ["tenantMembership", ["id"]],
    ["propertyMembership", ["id"]],
    ["role", ["id"]],
    ["roleAssignment", ["id"]],
  ]) assertExactKeys(fixture[key], key, allowed);
  assertUuid(fixture.tenant.id, "tenant.id");
  assertText(fixture.tenant.code, "tenant.code", { max: 80 });
  assertText(fixture.tenant.name, "tenant.name");
  assertUuid(fixture.property.id, "property.id");
  assertText(fixture.property.code, "property.code", { max: 80 });
  assertText(fixture.property.nameZh, "property.nameZh");
  assertText(fixture.property.nameEn, "property.nameEn");
  assertText(fixture.property.countryRegion, "property.countryRegion", { max: 10 });
  assertText(fixture.property.timezone, "property.timezone", { max: 80 });
  assertText(fixture.property.defaultLanguage, "property.defaultLanguage", { max: 20 });
  assertUuid(fixture.propertyDomain.id, "propertyDomain.id");
  assertText(fixture.propertyDomain.hostname, "propertyDomain.hostname", { lower: true, max: 253 });
  if (!HOSTNAME.test(fixture.propertyDomain.hostname)) fail("E5E_BOOTSTRAP_INVALID_FIXTURE", "propertyDomain.hostname invalid");
  assertUuid(fixture.profile.id, "profile.id");
  assertText(fixture.profile.displayName, "profile.displayName");
  assertText(fixture.profile.email, "profile.email", { max: 320 });
  assertUuid(fixture.userAccount.id, "userAccount.id");
  assertText(fixture.userAccount.loginId, "userAccount.loginId", { lower: true, max: 160 });
  for (const key of ["tenantMembership", "propertyMembership", "role", "roleAssignment"]) assertUuid(fixture[key].id, `${key}.id`);
  if (fixture.role.id === fixture.roleAssignment.id) fail("E5E_BOOTSTRAP_INVALID_FIXTURE", "role and assignment ids must differ");
  return true;
}

function assertRow(name, row, expected) {
  if (!row) fail("E5E_BOOTSTRAP_ROW_MISSING", name);
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) fail("E5E_BOOTSTRAP_ROW_CONFLICT", `${name}.${key}`);
  }
}

async function ensure(client, { name, selectSql, selectValues, insertSql, insertValues, expected }) {
  const before = await client.query(selectSql, selectValues);
  if (before.rows.length > 1) fail("E5E_BOOTSTRAP_ROW_CONFLICT", `${name} has multiple matches`);
  if (before.rows.length === 0) await client.query(insertSql, insertValues);
  const after = await client.query(selectSql, selectValues);
  if (after.rows.length !== 1) fail("E5E_BOOTSTRAP_ROW_MISSING", name);
  assertRow(name, after.rows[0], expected);
  return { created: before.rows.length === 0, row: after.rows[0] };
}

export async function bootstrapAcceptanceManager({ connectionString, fixture, env = process.env, client, pool, requestId = randomUUID(), now = new Date() }) {
  validateAcceptanceTarget(env);
  validateBootstrapConnectionString(connectionString);
  validateAcceptanceFixture(fixture);
  assertUuid(requestId, "requestId");
  if (!(client || pool)) {
    const createdPool = new Pool({ connectionString, max: 1, ssl: { rejectUnauthorized: true }, application_name: "e5e-acceptance-bootstrap" });
    pool = createdPool;
  }
  const dbClient = client || await pool.connect();
  const ownedClient = !client;
  const created = [];
  try {
    await dbClient.query("begin");
    const tenant = await ensure(dbClient, {
      name: "tenant", selectSql: SQL.tenantExisting, selectValues: [fixture.tenant.id, fixture.tenant.code], insertSql: SQL.tenantInsert, insertValues: [fixture.tenant.id, fixture.tenant.code, fixture.tenant.name], expected: { id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" },
    });
    if (tenant.created) created.push("tenant");
    const property = await ensure(dbClient, {
      name: "property", selectSql: SQL.propertyExisting, selectValues: [fixture.property.id, fixture.tenant.id, fixture.property.code], insertSql: SQL.propertyInsert, insertValues: [fixture.property.id, fixture.tenant.id, fixture.property.code, fixture.property.nameZh, fixture.property.nameEn, fixture.property.countryRegion, fixture.property.timezone, fixture.property.defaultLanguage], expected: { id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" },
    });
    if (property.created) created.push("property");
    const domain = await ensure(dbClient, {
      name: "propertyDomain", selectSql: SQL.domainExisting, selectValues: [fixture.propertyDomain.id, fixture.propertyDomain.hostname], insertSql: SQL.domainInsert, insertValues: [fixture.propertyDomain.id, fixture.tenant.id, fixture.property.id, fixture.propertyDomain.hostname], expected: { id: fixture.propertyDomain.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, hostname: fixture.propertyDomain.hostname, verification_status: "verified", is_active: true },
    });
    if (domain.created) created.push("propertyDomain");
    const profile = await ensure(dbClient, {
      name: "profile", selectSql: SQL.profileExisting, selectValues: [fixture.profile.id], insertSql: SQL.profileInsert, insertValues: [fixture.profile.id, fixture.profile.displayName, fixture.profile.email], expected: { id: fixture.profile.id, display_name: fixture.profile.displayName, email: fixture.profile.email, is_active: true },
    });
    if (profile.created) created.push("profile");
    const account = await ensure(dbClient, {
      name: "userAccount", selectSql: SQL.accountExisting, selectValues: [fixture.userAccount.id, fixture.authUserId, fixture.profile.id], insertSql: SQL.accountInsert, insertValues: [fixture.userAccount.id, fixture.authUserId, fixture.profile.id, fixture.tenant.id, fixture.property.id], expected: { id: fixture.userAccount.id, auth_user_id: fixture.authUserId, user_id: fixture.profile.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, account_status: "active" },
    });
    if (account.created) created.push("userAccount");
    const tenantMembership = await ensure(dbClient, {
      name: "tenantMembership", selectSql: SQL.tenantMembershipExisting, selectValues: [fixture.tenantMembership.id, fixture.tenant.id, fixture.profile.id], insertSql: SQL.tenantMembershipInsert, insertValues: [fixture.tenantMembership.id, fixture.tenant.id, fixture.profile.id], expected: { id: fixture.tenantMembership.id, tenant_id: fixture.tenant.id, user_id: fixture.profile.id, status: "active" },
    });
    if (tenantMembership.created) created.push("tenantMembership");
    const propertyMembership = await ensure(dbClient, {
      name: "propertyMembership", selectSql: SQL.propertyMembershipExisting, selectValues: [fixture.propertyMembership.id, fixture.property.id, fixture.profile.id], insertSql: SQL.propertyMembershipInsert, insertValues: [fixture.propertyMembership.id, fixture.tenant.id, fixture.property.id, fixture.profile.id], expected: { id: fixture.propertyMembership.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.profile.id, status: "active" },
    });
    if (propertyMembership.created) created.push("propertyMembership");
    const role = await ensure(dbClient, {
      name: "role", selectSql: SQL.roleExisting, selectValues: [fixture.role.id, fixture.tenant.id, fixture.property.id, "property_ld_manager"], insertSql: SQL.roleInsert, insertValues: [fixture.role.id, fixture.tenant.id, fixture.property.id], expected: { id: fixture.role.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, code: "property_ld_manager", scope_level: "property", is_active: true },
    });
    if (role.created) created.push("role");
    const assignment = await ensure(dbClient, {
      name: "roleAssignment", selectSql: SQL.assignmentExisting, selectValues: [fixture.roleAssignment.id, fixture.tenant.id, fixture.property.id, fixture.profile.id, fixture.role.id], insertSql: SQL.assignmentInsert, insertValues: [fixture.roleAssignment.id, fixture.tenant.id, fixture.property.id, fixture.profile.id, fixture.role.id], expected: { id: fixture.roleAssignment.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.profile.id, role_id: fixture.role.id, status: "active" },
    });
    if (assignment.created) created.push("roleAssignment");
    const details = JSON.stringify({ source: "acceptance-only-bootstrap", target: CANONICAL_ACCEPTANCE_TARGET, created, runtimePath: false, credentialsRecorded: false, authUserId: fixture.authUserId });
    await dbClient.query(SQL.auditInsert, [requestId, fixture.authUserId, fixture.profile.id, fixture.tenant.id, fixture.property.id, fixture.profile.id, details]);
    await dbClient.query("commit");
    return { status: created.length === 0 ? "already_present" : "created", created, requestId, authUserId: fixture.authUserId, tenantId: fixture.tenant.id, propertyId: fixture.property.id, profileId: fixture.profile.id, roleAssignmentId: fixture.roleAssignment.id, committedAt: now.toISOString() };
  } catch (error) {
    try { await dbClient.query("rollback"); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    if (ownedClient) {
      dbClient.release();
      await pool.end();
    }
  }
}

function parseArgs(argv) {
  const args = { fixture: null, evidenceFile: "/private/tmp/e5e-canonical-acceptance-bootstrap-evidence.json", connectionStdin: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fixture") args.fixture = argv[++i];
    else if (arg === "--evidence-file") args.evidenceFile = argv[++i];
    else if (arg === "--connection-stdin") args.connectionStdin = true;
    else fail("E5E_BOOTSTRAP_ARGUMENT_INVALID", arg);
  }
  if (!args.fixture) fail("E5E_BOOTSTRAP_FIXTURE_REQUIRED");
  if (!args.connectionStdin && !process.env.NEON_BOOTSTRAP_DATABASE_URL) fail("E5E_BOOTSTRAP_DATABASE_URL_REQUIRED");
  if (typeof args.evidenceFile !== "string" || !SAFE_EVIDENCE_ROOTS.some((root) => args.evidenceFile.startsWith(root))) fail("E5E_BOOTSTRAP_EVIDENCE_PATH_FORBIDDEN");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(args.fixture, "utf8"));
  let connectionString = process.env.NEON_BOOTSTRAP_DATABASE_URL;
  if (args.connectionStdin) {
    connectionString = (await new Promise((resolve, reject) => {
      let value = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { value += chunk; });
      process.stdin.on("end", () => resolve(value.trim()));
      process.stdin.on("error", reject);
    }));
  }
  const result = await bootstrapAcceptanceManager({ connectionString, fixture });
  await writeFile(args.evidenceFile, `${JSON.stringify({ ...result, target: CANONICAL_ACCEPTANCE_TARGET, credentialsRecorded: false, runtimePath: false }, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...result, target: CANONICAL_ACCEPTANCE_TARGET, credentialsRecorded: false, evidenceFile: args.evidenceFile })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || "E5E_BOOTSTRAP_FAILED"}\n`);
    process.exitCode = 1;
  });
}
