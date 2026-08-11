import assert from "node:assert/strict";
import test from "node:test";
import { initializeNeonFirstEnvironment } from "./neon-first-initialization-operator.mjs";
import { authUserId, fixture, target } from "./fixtures/neon-first-initialization-test-fixture.mjs";

const directConnectionString = "postgresql://neondb_owner:fixture@ep-fresh-neon.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

function acceptanceFixture(code = "acc-deadbeef") {
  return { ...fixture, tenant: { ...fixture.tenant, code }, property: { ...fixture.property, code } };
}

test("operator rolls back the entire initialization when an immutable tenant value conflicts", async () => {
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text === "begin" || text === "rollback" || text === "commit") return { rows: [] };
      if (text.includes("from public.tenants")) {
        return { rows: [{ id: fixture.tenant.id, code: fixture.tenant.code, name: "Different tenant", status: "active" }] };
      }
      throw new Error(`unexpected query after tenant conflict: ${text}`);
    },
  };

  await assert.rejects(
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] }),
    /NEON_FIRST_INIT_ROW_CONFLICT/
  );
  assert.deepEqual(calls.map(({ text }) => text), ["begin", "select id, code, name, status from public.tenants where id = $1 or code = $2 order by id", "select id, code, name, status from public.tenants where id = $1 or code = $2 order by id", "rollback"]);
});

test("operator creates the minimum runnable graph atomically and records no Auth credential", async () => {
  const calls = [];
  const createdTables = new Set();
  const initializationSteps = [];
  const expectedRows = new Map([
    ["tenants", { id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" }],
    ["properties", { id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" }],
    ["property_domains", { id: fixture.propertyDomain.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, hostname: fixture.propertyDomain.hostname, verification_status: "verified", is_active: true }],
    ["profiles", { id: fixture.manager.profileId, display_name: fixture.manager.displayName, email: fixture.manager.email, is_active: true }],
    ["user_accounts", { id: fixture.manager.accountId, auth_user_id: authUserId, user_id: fixture.manager.profileId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, account_status: "active" }],
    ["tenant_memberships", { id: fixture.manager.tenantMembershipId, tenant_id: fixture.tenant.id, user_id: fixture.manager.profileId, status: "active" }],
    ["property_memberships", { id: fixture.manager.propertyMembershipId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, status: "active" }],
    ["roles", { id: fixture.manager.roleId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, code: "property_ld_manager", scope_level: "property", is_active: true }],
    ["role_assignments", { id: fixture.manager.roleAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, role_id: fixture.manager.roleId, status: "active" }],
    ["property_settings", { id: fixture.initialization.settingsId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, initialization_state: "in_progress", initialization_last_active_step: 5 }],
    ["departments", { id: fixture.developmentSeed.departmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["position_families", { id: fixture.developmentSeed.positionFamilyId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["positions", { id: fixture.developmentSeed.positionId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["position_department_assignments", { id: fixture.developmentSeed.positionDepartmentAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, position_id: fixture.developmentSeed.positionId, department_id: fixture.developmentSeed.departmentId, is_active: true }],
    ["employees", { id: fixture.developmentSeed.employeeId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_number: "DEV-001", is_active: true }],
    ["employee_external_identifiers", { id: fixture.developmentSeed.employeeIdentifierId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_id: fixture.developmentSeed.employeeId, source_system: "neon-first-seed", identifier_value: "DEV-001", is_active: true }],
  ]);
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text === "begin" || text === "rollback" || text === "commit" || text.includes("audit_events")) return { rows: [] };
      if (text.includes("insert into public.position_department_assignments") && /\bis_primary\b/i.test(text)) {
        throw Object.assign(new Error("column is_primary does not exist"), { code: "42703", column: "is_primary" });
      }
      if (text.includes("from public.property_initialization_steps")) return { rows: initializationSteps };
      if (text.includes("insert into public.property_initialization_steps")) {
        initializationSteps.push({ id: values[0], tenant_id: values[1], property_id: values[2], step_key: values[3], explicitly_confirmed: values[4] });
        return { rows: [] };
      }
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) {
        createdTables.add(insert[1]);
        return { rows: [] };
      }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: createdTables.has(select[1]) ? [expectedRows.get(select[1])] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const result = await initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target], requestId: "13131313-1313-4131-8131-131313131313" });
  assert.equal(result.status, "created");
  assert.deepEqual(result.created, ["tenant", "property", "propertyDomain", "profile", "userAccount", "tenantMembership", "propertyMembership", "role", "roleAssignment", "propertySettings", "initializationSteps", "department", "positionFamily", "position", "positionDepartmentAssignment", "employee", "employeeIdentifier"]);
  assert.equal(calls.at(-1).text, "commit");
  assert.ok(calls.some(({ text }) => text.includes("organization_write_audit_events")));
  assert.ok(calls.some(({ text }) => text.includes("property_write_audit_events")));
  assert.ok(calls.some(({ text }) => text.includes("initialization_audit_events")));
  assert.ok(calls.every(({ text, values }) => !/\bset\s+(local\s+)?role\b|\bgrant\b|\brevoke\b/i.test(text) && !JSON.stringify(values).includes("password")));
});

test("operator rebinds a terminal acceptance hostname and the next run is idempotent", async () => {
  const candidate = acceptanceFixture();
  const calls = [];
  const createdTables = new Set();
  const initializationSteps = [];
  const expectedRows = new Map([
    ["tenants", { id: candidate.tenant.id, code: candidate.tenant.code, name: candidate.tenant.name, status: "active" }],
    ["properties", { id: candidate.property.id, tenant_id: candidate.tenant.id, code: candidate.property.code, name_zh: candidate.property.nameZh, name_en: candidate.property.nameEn, status: "active" }],
    ["property_domains", { id: fixture.propertyDomain.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, hostname: fixture.propertyDomain.hostname, verification_status: "verified", is_active: true }],
    ["profiles", { id: fixture.manager.profileId, display_name: fixture.manager.displayName, email: fixture.manager.email, is_active: true }],
    ["user_accounts", { id: fixture.manager.accountId, auth_user_id: authUserId, user_id: fixture.manager.profileId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, account_status: "active" }],
    ["tenant_memberships", { id: fixture.manager.tenantMembershipId, tenant_id: fixture.tenant.id, user_id: fixture.manager.profileId, status: "active" }],
    ["property_memberships", { id: fixture.manager.propertyMembershipId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, status: "active" }],
    ["roles", { id: fixture.manager.roleId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, code: "property_ld_manager", scope_level: "property", is_active: true }],
    ["role_assignments", { id: fixture.manager.roleAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.manager.profileId, role_id: fixture.manager.roleId, status: "active" }],
    ["property_settings", { id: fixture.initialization.settingsId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, initialization_state: "in_progress", initialization_last_active_step: 5 }],
    ["departments", { id: fixture.developmentSeed.departmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["position_families", { id: fixture.developmentSeed.positionFamilyId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["positions", { id: fixture.developmentSeed.positionId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, is_active: true }],
    ["position_department_assignments", { id: fixture.developmentSeed.positionDepartmentAssignmentId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, position_id: fixture.developmentSeed.positionId, department_id: fixture.developmentSeed.departmentId, is_active: true }],
    ["employees", { id: fixture.developmentSeed.employeeId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_number: "DEV-001", is_active: true }],
    ["employee_external_identifiers", { id: fixture.developmentSeed.employeeIdentifierId, tenant_id: fixture.tenant.id, property_id: fixture.property.id, employee_id: fixture.developmentSeed.employeeId, source_system: "neon-first-seed", identifier_value: "DEV-001", is_active: true }],
  ]);
  const historicalDomainId = "13131313-1313-4131-8131-131313131313";
  let domain = {
    id: historicalDomainId,
    tenant_id: "14141414-1414-4141-8141-141414141414",
    property_id: "15151515-1515-4151-8151-151515151515",
    hostname: fixture.propertyDomain.hostname,
    verification_status: "verified",
    is_active: false,
  };
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (["begin", "rollback", "commit"].includes(text)) return { rows: [] };
      if (text.includes("from public.property_initialization_steps")) return { rows: initializationSteps };
      if (text.includes("insert into public.property_initialization_steps")) {
        initializationSteps.push({ id: values[0], tenant_id: values[1], property_id: values[2], step_key: values[3], explicitly_confirmed: values[4] });
        return { rows: [] };
      }
      if (text.includes("to_regclass('public.import_commits')")) return { rows: [{ import_commits: null }] };
      if (text.includes("from public.property_domains") && text.includes("join public.tenants")) {
        return { rows: [{ tenant_code: "acc-cafebabe", tenant_status: "inactive", property_code: "acc-cafebabe", property_status: "inactive", terminal_acceptance: true }] };
      }
      if (text.includes("audit_events")) return { rows: [] };
      if (text.startsWith("update public.property_domains")) {
        assert.deepEqual(values, [fixture.tenant.id, fixture.property.id, domain.id, fixture.propertyDomain.hostname, domain.tenant_id, domain.property_id]);
        domain = { ...expectedRows.get("property_domains"), id: historicalDomainId };
        createdTables.add("property_domains");
        return { rowCount: 1, rows: [domain] };
      }
      if (text.includes("from public.property_domains")) return { rows: [domain] };
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) {
        createdTables.add(insert[1]);
        return { rows: [] };
      }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: createdTables.has(select[1]) ? [expectedRows.get(select[1])] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  const first = await initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture: candidate, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] });
  const second = await initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture: candidate, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] });
  assert.equal(first.status, "created");
  assert.equal(second.status, "already_present");
  assert.equal(domain.id, historicalDomainId);
  assert.equal(calls.filter(({ text }) => text.startsWith("update public.property_domains")).length, 1);
});

test("operator rejects an active non-acceptance hostname with a stable contract", async () => {
  const created = new Set();
  const domain = {
    id: "13131313-1313-4131-8131-131313131313",
    tenant_id: "14141414-1414-4141-8141-141414141414",
    property_id: "15151515-1515-4151-8151-151515151515",
    hostname: fixture.propertyDomain.hostname,
    verification_status: "verified",
    is_active: true,
  };
  const rows = {
    tenants: { id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" },
    properties: { id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" },
  };
  const client = {
    async query(text) {
      if (["begin", "rollback", "commit"].includes(text)) return { rows: [] };
      if (text.includes("from public.property_domains")) return { rows: [domain] };
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) {
        created.add(insert[1]);
        return { rows: [] };
      }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: created.has(select[1]) ? [rows[select[1]]] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] }),
    error => error?.code === "NEON_FIRST_INIT_ROW_CONFLICT:PROPERTY_DOMAINS:HOSTNAME"
  );
});

test("operator rejects an inactive hostname whose previous acceptance aggregate is not terminal", async () => {
  const created = new Set();
  const domain = {
    id: "13131313-1313-4131-8131-131313131313",
    tenant_id: "14141414-1414-4141-8141-141414141414",
    property_id: "15151515-1515-4151-8151-151515151515",
    hostname: fixture.propertyDomain.hostname,
    verification_status: "verified",
    is_active: false,
  };
  const rows = {
    tenants: { id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" },
    properties: { id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" },
  };
  const client = {
    async query(text) {
      if (["begin", "rollback", "commit"].includes(text)) return { rows: [] };
      if (text.includes("from public.property_domains") && text.includes("join public.tenants")) {
        return { rows: [{ tenant_code: "acc-prior", tenant_status: "inactive", property_code: "acc-prior", property_status: "inactive", terminal_acceptance: false }] };
      }
      if (text.includes("from public.property_domains")) return { rows: [domain] };
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) {
        created.add(insert[1]);
        return { rows: [] };
      }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: created.has(select[1]) ? [rows[select[1]]] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };

  await assert.rejects(
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] }),
    error => error?.code === "NEON_FIRST_INIT_ROW_CONFLICT:PROPERTY_DOMAINS:HOSTNAME"
  );
});

test("operator does not treat an acc-prefix historical business aggregate as acceptance evidence", async () => {
  const candidate = acceptanceFixture();
  const created = new Set();
  const domain = { id: "13131313-1313-4131-8131-131313131313", tenant_id: "14141414-1414-4141-8141-141414141414", property_id: "15151515-1515-4151-8151-151515151515", hostname: candidate.propertyDomain.hostname, verification_status: "verified", is_active: false };
  const rows = {
    tenants: { id: candidate.tenant.id, code: candidate.tenant.code, name: candidate.tenant.name, status: "active" },
    properties: { id: candidate.property.id, tenant_id: candidate.tenant.id, code: candidate.property.code, name_zh: candidate.property.nameZh, name_en: candidate.property.nameEn, status: "active" },
  };
  const client = {
    async query(text) {
      if (["begin", "rollback", "commit"].includes(text)) return { rows: [] };
      if (text.includes("from public.property_domains") && text.includes("join public.tenants")) return { rows: [{ tenant_code: "acc-business", property_code: "acc-business", terminal_acceptance: true }] };
      if (text.includes("from public.property_domains")) return { rows: [domain] };
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) { created.add(insert[1]); return { rows: [] }; }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: created.has(select[1]) ? [rows[select[1]]] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  await assert.rejects(
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture: candidate, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] }),
    error => error?.code === "NEON_FIRST_INIT_ROW_CONFLICT:PROPERTY_DOMAINS:HOSTNAME"
  );
});

test("operator rejects terminal-looking acceptance history with an unreverted Import commit", async () => {
  const candidate = acceptanceFixture();
  const created = new Set();
  const domain = { id: "13131313-1313-4131-8131-131313131313", tenant_id: "14141414-1414-4141-8141-141414141414", property_id: "15151515-1515-4151-8151-151515151515", hostname: candidate.propertyDomain.hostname, verification_status: "verified", is_active: false };
  const rows = {
    tenants: { id: candidate.tenant.id, code: candidate.tenant.code, name: candidate.tenant.name, status: "active" },
    properties: { id: candidate.property.id, tenant_id: candidate.tenant.id, code: candidate.property.code, name_zh: candidate.property.nameZh, name_en: candidate.property.nameEn, status: "active" },
  };
  const client = {
    async query(text) {
      if (["begin", "rollback", "commit"].includes(text)) return { rows: [] };
      if (text.includes("to_regclass('public.import_commits')")) return { rows: [{ import_commits: "public.import_commits" }] };
      if (text.includes("from public.import_commits")) return { rows: [{ count: 1 }] };
      if (text.includes("from public.property_domains") && text.includes("join public.tenants")) return { rows: [{ tenant_code: "acc-cafebabe", property_code: "acc-cafebabe", terminal_acceptance: true }] };
      if (text.includes("from public.property_domains")) return { rows: [domain] };
      const insert = text.match(/insert into public\.([a-z_]+)/);
      if (insert) { created.add(insert[1]); return { rows: [] }; }
      const select = text.match(/from public\.([a-z_]+)/);
      if (select) return { rows: created.has(select[1]) ? [rows[select[1]]] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  await assert.rejects(
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture: candidate, authUserId, client, environment: { APP_ENV: "development" }, approvedTargets: [target] }),
    error => error?.code === "NEON_FIRST_INIT_ROW_CONFLICT:PROPERTY_DOMAINS:HOSTNAME"
  );
});
