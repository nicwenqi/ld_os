export const NEON_FIRST_INITIALIZATION_SEED_VERSION = "neon-first-development-v1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TARGET_KEYS = ["environment", "projectId", "branchId", "endpointId", "database", "directHostPrefix"];
const STEP_KEYS = ["identity", "rules", "organization", "positions", "upload", "mapping", "access", "readiness"];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function assertExactKeys(value, keys, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(code);
}

function assertUuid(value, code) {
  if (typeof value !== "string" || !UUID.test(value)) fail(code);
}

function assertText(value, code, max = 200) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value !== value.trim()) fail(code);
}

export function validateInitializationTarget(target, environment = process.env) {
  assertExactKeys(target, TARGET_KEYS, "NEON_FIRST_INIT_TARGET_INVALID");
  if (!['development', 'staging'].includes(target.environment) || environment.APP_ENV === 'production' || target.projectId.toLowerCase().includes('production') || target.branchId.toLowerCase().includes('production')) {
    fail("NEON_FIRST_INIT_TARGET_FORBIDDEN");
  }
  for (const key of ["projectId", "branchId", "endpointId", "database", "directHostPrefix"]) assertText(target[key], "NEON_FIRST_INIT_TARGET_INVALID", 200);
  if (target.database !== "neondb" || !target.directHostPrefix.startsWith(`${target.endpointId}.`) || target.directHostPrefix.includes("-pooler.")) fail("NEON_FIRST_INIT_TARGET_INVALID");
  if (environment.DATABASE_URL || environment.NEON_RUNTIME_DATABASE_URL) fail("NEON_FIRST_INIT_RUNTIME_URL_FORBIDDEN");
  return true;
}

export function validateInitializationFixture(fixture, authUserId) {
  assertUuid(authUserId, "NEON_FIRST_INIT_AUTH_USER_INVALID");
  assertExactKeys(fixture, ["seedVersion", "tenant", "property", "propertyDomain", "manager", "initialization", "developmentSeed"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  if (fixture.seedVersion !== NEON_FIRST_INITIALIZATION_SEED_VERSION) fail("NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.tenant, ["id", "code", "name"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.property, ["id", "code", "nameZh", "nameEn", "countryRegion", "timezone", "defaultLanguage"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.propertyDomain, ["id", "hostname"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.manager, ["profileId", "accountId", "tenantMembershipId", "propertyMembershipId", "roleId", "roleAssignmentId", "displayName", "email", "loginId"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.initialization, ["settingsId", "steps"], "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.initialization.steps, STEP_KEYS, "NEON_FIRST_INIT_FIXTURE_INVALID");
  assertExactKeys(fixture.developmentSeed, ["departmentId", "positionFamilyId", "positionId", "positionDepartmentAssignmentId", "employeeId", "employeeIdentifierId"], "NEON_FIRST_INIT_FIXTURE_INVALID");

  const textFields = [
    fixture.tenant.code, fixture.tenant.name,
    fixture.property.code, fixture.property.nameZh, fixture.property.nameEn, fixture.property.countryRegion, fixture.property.timezone, fixture.property.defaultLanguage,
    fixture.propertyDomain.hostname,
    fixture.manager.displayName, fixture.manager.email, fixture.manager.loginId,
  ];
  for (const value of textFields) assertText(value, "NEON_FIRST_INIT_FIXTURE_INVALID", 320);
  if (fixture.propertyDomain.hostname !== fixture.propertyDomain.hostname.toLowerCase() || !HOSTNAME.test(fixture.propertyDomain.hostname)) fail("NEON_FIRST_INIT_FIXTURE_INVALID");
  if (!fixture.manager.email.includes("@")) fail("NEON_FIRST_INIT_FIXTURE_INVALID");

  const identifiers = [
    fixture.tenant.id, fixture.property.id, fixture.propertyDomain.id,
    fixture.manager.profileId, fixture.manager.accountId, fixture.manager.tenantMembershipId, fixture.manager.propertyMembershipId, fixture.manager.roleId, fixture.manager.roleAssignmentId,
    fixture.initialization.settingsId, ...Object.values(fixture.initialization.steps),
    fixture.developmentSeed.departmentId, fixture.developmentSeed.positionFamilyId, fixture.developmentSeed.positionId, fixture.developmentSeed.positionDepartmentAssignmentId, fixture.developmentSeed.employeeId, fixture.developmentSeed.employeeIdentifierId,
  ];
  for (const value of identifiers) assertUuid(value, "NEON_FIRST_INIT_FIXTURE_INVALID");
  if (new Set(identifiers).size !== identifiers.length) fail("NEON_FIRST_INIT_FIXTURE_INVALID");
  return true;
}

export const NEON_FIRST_INITIALIZATION_STEP_KEYS = Object.freeze(STEP_KEYS);
