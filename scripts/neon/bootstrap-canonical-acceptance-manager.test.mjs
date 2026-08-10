import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapAcceptanceManager, CANONICAL_ACCEPTANCE_TARGET, validateAcceptanceFixture, validateAcceptanceTarget, validateBootstrapConnectionString, BOOTSTRAP_CONFIRMATION } from "./bootstrap-canonical-acceptance-manager.mjs";

const fixture = {
  authUserId: "05a561ea-1e14-4920-abd1-ff41b9e29bee",
  tenant: { id: "11111111-1111-4111-8111-111111111111", code: "acceptance-tenant", name: "Acceptance Tenant" },
  property: { id: "22222222-2222-4222-8222-222222222222", code: "acceptance-hotel", nameZh: "验收酒店", nameEn: "Acceptance Hotel", countryRegion: "CN", timezone: "Asia/Shanghai", defaultLanguage: "zh-CN" },
  propertyDomain: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hostname: "acceptance.ldchub.cn" },
  profile: { id: "99999999-9999-4999-8999-999999999999", displayName: "Acceptance Manager", email: "manager@example.test" },
  userAccount: { id: "99999999-9999-4999-8999-999999999996", loginId: "acceptance-manager" },
  tenantMembership: { id: "99999999-9999-4999-8999-999999999998" },
  propertyMembership: { id: "99999999-9999-4999-8999-999999999997" },
  role: { id: "99999999-9999-4999-8999-999999999995" },
  roleAssignment: { id: "99999999-9999-4999-8999-999999999994" },
};

const targetEnv = {
  ACCEPTANCE_BOOTSTRAP_CONFIRM: BOOTSTRAP_CONFIRMATION,
  NEON_ACCEPTANCE_PROJECT_ID: CANONICAL_ACCEPTANCE_TARGET.projectId,
  NEON_ACCEPTANCE_BRANCH_ID: CANONICAL_ACCEPTANCE_TARGET.branchId,
  NEON_ACCEPTANCE_ENDPOINT_ID: CANONICAL_ACCEPTANCE_TARGET.endpointId,
  NEON_ACCEPTANCE_DATABASE: CANONICAL_ACCEPTANCE_TARGET.database,
};

function directUrl(user = "neondb_owner", host = "ep-frosty-math-audxlq88.ap-southeast-1.aws.neon.tech") {
  return `postgresql://${user}:redacted@${host}/neondb?sslmode=require&channel_binding=require`;
}

test("acceptance target and direct operator URL are fail-closed", () => {
  assert.equal(validateAcceptanceTarget(targetEnv), true);
  assert.equal(validateBootstrapConnectionString(directUrl("neondb_owner", "ep-frosty-math-audxlq88.ap-southeast-1.aws.neon.tech")).hostname, "ep-frosty-math-audxlq88.ap-southeast-1.aws.neon.tech");
  assert.throws(() => validateAcceptanceTarget({ ...targetEnv, NEON_ACCEPTANCE_BRANCH_ID: "br-aged-river-az1gke14" }), /E5E_BOOTSTRAP_TARGET_MISMATCH/);
  assert.throws(() => validateBootstrapConnectionString(directUrl("hotel_ld_application")), /E5E_BOOTSTRAP_ROLE_MISMATCH/);
  assert.throws(() => validateBootstrapConnectionString(directUrl("neondb_owner", "ep-sparkling-shape-az9gxtuh.ap-southeast-1.aws.neon.tech")), /E5E_BOOTSTRAP_ENDPOINT_MISMATCH/);
  assert.throws(() => validateBootstrapConnectionString("postgresql://neondb_owner:redacted@ep-frosty-math-audxlq88.neon.tech/neondb?sslmode=disable"), /E5E_BOOTSTRAP_SSL_REQUIRED/);
});

test("fixture is closed, manager-only, and rejects unknown or invalid fields", () => {
  assert.equal(validateAcceptanceFixture(fixture), true);
  assert.throws(() => validateAcceptanceFixture({ ...fixture, role: { ...fixture.role, code: "tenant_admin" } }), /unexpected fields/);
  assert.throws(() => validateAcceptanceFixture({ ...fixture, extra: true }), /unexpected fields/);
  assert.throws(() => validateAcceptanceFixture({ ...fixture, propertyDomain: { ...fixture.propertyDomain, hostname: "https://bad.example" } }), /hostname invalid/);
});

test("bootstrap uses one transaction, no SET ROLE, and writes an append-only audit event", async () => {
  const calls = [];
  const inserted = new Set();
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      assert.doesNotMatch(text, /\bset\s+(local\s+)?role\b/i);
      if (text === "begin" || text === "commit" || text === "rollback") return { rows: [] };
      if (text.includes("organization_write_audit_events")) return { rows: [] };
      if (text.includes("insert into")) {
        const table = text.match(/insert into (?:public|app_private)\.([a-z_]+)/)?.[1];
        if (table) inserted.add(table);
        return { rows: [] };
      }
      const isTenant = text.includes("from public.tenants");
      const isProperty = text.includes("from public.properties");
      const isDomain = text.includes("from public.property_domains");
      const isProfile = text.includes("from public.profiles");
      const isAccount = text.includes("from public.user_accounts");
      const isTenantMembership = text.includes("from public.tenant_memberships");
      const isPropertyMembership = text.includes("from public.property_memberships");
      const isRole = text.includes("from public.roles");
      const isAssignment = text.includes("from public.role_assignments");
      if (isTenant) return { rows: inserted.has("tenants") ? [{ id: fixture.tenant.id, code: fixture.tenant.code, name: fixture.tenant.name, status: "active" }] : [] };
      if (isProperty) return { rows: inserted.has("properties") ? [{ id: fixture.property.id, tenant_id: fixture.tenant.id, code: fixture.property.code, name_zh: fixture.property.nameZh, name_en: fixture.property.nameEn, status: "active" }] : [] };
      if (isDomain) return { rows: inserted.has("property_domains") ? [{ id: fixture.propertyDomain.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, hostname: fixture.propertyDomain.hostname, verification_status: "verified", is_active: true }] : [] };
      if (isProfile) return { rows: inserted.has("profiles") ? [{ id: fixture.profile.id, display_name: fixture.profile.displayName, email: fixture.profile.email, is_active: true }] : [] };
      if (isAccount) return { rows: inserted.has("user_accounts") ? [{ id: fixture.userAccount.id, auth_user_id: fixture.authUserId, user_id: fixture.profile.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, account_status: "active" }] : [] };
      if (isTenantMembership) return { rows: inserted.has("tenant_memberships") ? [{ id: fixture.tenantMembership.id, tenant_id: fixture.tenant.id, user_id: fixture.profile.id, status: "active" }] : [] };
      if (isPropertyMembership) return { rows: inserted.has("property_memberships") ? [{ id: fixture.propertyMembership.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.profile.id, status: "active" }] : [] };
      if (isRole) return { rows: inserted.has("roles") ? [{ id: fixture.role.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, code: "property_ld_manager", scope_level: "property", is_active: true }] : [] };
      if (isAssignment) return { rows: inserted.has("role_assignments") ? [{ id: fixture.roleAssignment.id, tenant_id: fixture.tenant.id, property_id: fixture.property.id, user_id: fixture.profile.id, role_id: fixture.role.id, status: "active" }] : [] };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const result = await bootstrapAcceptanceManager({ connectionString: directUrl(), fixture, env: targetEnv, client, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab" });
  assert.equal(result.status, "created");
  assert.deepEqual(calls.map(({ text }) => text).slice(0, 2), ["begin", "select id, code, name, status from public.tenants where id = $1 or code = $2 order by id"]);
  assert.equal(calls.at(-1).text, "commit");
  assert.ok(calls.some(({ text }) => text.includes("organization_write_audit_events")));
  assert.ok(calls.every(({ text }) => !/grant\s|revoke\s|create\s+role/i.test(text)));
});

test("target guard rejects runtime URLs and missing confirmation before client use", () => {
  assert.throws(() => validateAcceptanceTarget({ ...targetEnv, DATABASE_URL: directUrl("hotel_ld_application") }), /E5E_BOOTSTRAP_RUNTIME_URL_FORBIDDEN/);
  assert.throws(() => validateAcceptanceTarget({ ...targetEnv, ACCEPTANCE_BOOTSTRAP_CONFIRM: "" }), /E5E_BOOTSTRAP_CONFIRMATION_REQUIRED/);
});
