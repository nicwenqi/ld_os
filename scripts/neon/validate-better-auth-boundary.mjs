const BUSINESS_SCHEMAS = ["public", "app_private"];
const BUSINESS_ROLE_NAMES = ["hotel_ld_application", "hotel_ld_migration_owner"];

export function validateBetterAuthBoundarySource(sql) {
  const source = stripSqlComments(String(sql));
  if (!/\bcreate\s+schema\s+app_auth\s+authorization\s+hotel_ld_auth_service\s*;/i.test(source)) {
    fail("AUTH_SCHEMA_BOUNDARY", "app_auth must be owned by hotel_ld_auth_service");
  }
  if (!/\bgrant\s+hotel_ld_auth_service\s+to\s+session_user\s+with\s+inherit\s+false\s*,\s*set\s+true\s*,\s*admin\s+false\s*;/i.test(source)) {
    fail("AUTH_SERVICE_BOOTSTRAP_MEMBERSHIP", "schema ownership requires only bootstrap-session SET membership");
  }
  const role = source.match(/\bcreate\s+role\s+hotel_ld_auth_service\s+([\s\S]*?);/i)?.[1] ?? "";
  if (!/\blogin\b/i.test(role) || !/\bnoinherit\b/i.test(role) ||
      !/\bnosuperuser\b/i.test(role) || !/\bnobypassrls\b/i.test(role) ||
      !/\bnocreatedb\b/i.test(role) || !/\bnocreaterole\b/i.test(role) ||
      !/\bnoreplication\b/i.test(role)) {
    fail("AUTH_SERVICE_ROLE_SECURITY", "hotel_ld_auth_service must be a minimal LOGIN role");
  }
  for (const schema of BUSINESS_SCHEMAS) {
    if (!new RegExp(`\\brevoke\\s+all\\s+on\\s+schema\\s+${schema}\\s+from\\s+hotel_ld_auth_service\\s*;`, "i").test(source)) {
      fail("AUTH_SERVICE_BUSINESS_PRIVILEGE", `hotel_ld_auth_service must be revoked from ${schema}`);
    }
  }
  if (!/\brevoke\s+all\s+on\s+schema\s+app_auth\s+from\s+hotel_ld_application\s*;/i.test(source) ||
      /\bgrant\s+[\s\S]*?\s+on\s+schema\s+app_auth\s+to\s+hotel_ld_application\s*;/i.test(source)) {
    fail("APPLICATION_AUTH_SCHEMA_PRIVILEGE", "hotel_ld_application must not use app_auth");
  }
  if (!/\bgrant\s+(?:usage\s*,\s*create|create\s*,\s*usage)\s+on\s+schema\s+app_auth\s+to\s+hotel_ld_auth_service\s*;/i.test(source)) {
    fail("AUTH_SCHEMA_BOUNDARY", "auth service needs only app_auth schema usage/create");
  }
  if (!/\balter\s+role\s+hotel_ld_auth_service\s+set\s+search_path\s*=\s*app_auth\s*,\s*pg_catalog\s*;/i.test(source)) {
    fail("AUTH_SERVICE_SEARCH_PATH", "auth service requires a fixed private search_path");
  }
  for (const businessRole of BUSINESS_ROLE_NAMES) {
    if (new RegExp(`\\bgrant\\s+${businessRole}\\s+to\\s+hotel_ld_auth_service\\s*;|\\bgrant\\s+hotel_ld_auth_service\\s+to\\s+${businessRole}\\s*;`, "i").test(source)) {
      fail("AUTH_SERVICE_ROLE_MEMBERSHIP", "auth service may not join a business role");
    }
  }
  const roleMemberships = source.matchAll(/\bgrant\s+([^;]+?)\s+to\s+([^;\s]+)(?:\s+with\s+[^;]+)?\s*;/gi);
  for (const membership of roleMemberships) {
    const grantedRole = membership[1].trim().toLowerCase();
    const grantee = membership[2].trim().toLowerCase();
    if (grantedRole !== "hotel_ld_auth_service" && grantee !== "hotel_ld_auth_service") continue;
    if (grantedRole === "hotel_ld_auth_service" && grantee === "session_user" &&
        /\bwith\s+inherit\s+false\s*,\s*set\s+true\s*,\s*admin\s+false\s*;/i.test(membership[0])) continue;
    if (/\bon\s+/i.test(membership[0])) continue;
    fail("AUTH_SERVICE_ROLE_MEMBERSHIP", "auth service only permits bootstrap-session SET membership");
  }
  const grants = source.matchAll(/\bgrant\s+([\s\S]*?)\s+to\s+hotel_ld_auth_service\s*;/gi);
  for (const grant of grants) {
    const statement = grant[0];
    if (/\bon\s+schema\s+app_auth\b/i.test(statement)) continue;
    if (/\bon\s+database\s+neondb\b/i.test(statement) && /\bconnect\b/i.test(statement)) continue;
    fail("AUTH_SERVICE_BUSINESS_PRIVILEGE", "auth service may not receive business object privileges");
  }
  return { schema: "app_auth", role: "hotel_ld_auth_service" };
}

function stripSqlComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}
