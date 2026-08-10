import assert from "node:assert/strict";
import test from "node:test";
import { initializeNeonFirstEnvironment } from "./neon-first-initialization-operator.mjs";
import { authUserId, fixture, target } from "./neon-first-initialization-contract.test.mjs";

const directConnectionString = "postgresql://neondb_owner:fixture@ep-fresh-neon.c-10.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";

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
    initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" } }),
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

  const result = await initializeNeonFirstEnvironment({ connectionString: directConnectionString, target, fixture, authUserId, client, environment: { APP_ENV: "development" }, requestId: "13131313-1313-4131-8131-131313131313" });
  assert.equal(result.status, "created");
  assert.deepEqual(result.created, ["tenant", "property", "propertyDomain", "profile", "userAccount", "tenantMembership", "propertyMembership", "role", "roleAssignment", "propertySettings", "initializationSteps", "department", "positionFamily", "position", "positionDepartmentAssignment", "employee", "employeeIdentifier"]);
  assert.equal(calls.at(-1).text, "commit");
  assert.ok(calls.some(({ text }) => text.includes("organization_write_audit_events")));
  assert.ok(calls.some(({ text }) => text.includes("property_write_audit_events")));
  assert.ok(calls.some(({ text }) => text.includes("initialization_audit_events")));
  assert.ok(calls.every(({ text, values }) => !/\bset\s+(local\s+)?role\b|\bgrant\b|\brevoke\b/i.test(text) && !JSON.stringify(values).includes("password")));
});
