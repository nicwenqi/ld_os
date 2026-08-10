import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { validateAuthAuthorizationSplitSources } from "../scripts/neon/validate-auth-authorization-split.mjs";
import * as canonicalValidator from "../scripts/neon/validate-canonical-neon-baseline.mjs";

const authentication = await import("../app/services/authentication-service.ts");
const requestAuthentication = await import("../app/services/request-authentication.ts");
const productionAuthorization = await import("../app/services/production-authorization.ts");

const hostname = "hotel.example.test";
const loginId = "property-manager";
const password = "HotelDemo2026";

test("login rejects a Supabase Auth user ID that is not verified from its access token", async () => {
  assert.equal(typeof authentication.resolveLoginWith, "function");

  const result = await authentication.resolveLoginWith({
    hostname,
    loginId,
    password,
    neon: fakeManagerAuthority(),
    auth: fakeAuthSignIn({
      signedInUserId: "22222222-2222-4222-8222-222222222222",
      verifiedUserId: "11111111-1111-4111-8111-111111111111",
    }),
    deriveAuthEmail(loginId, receivedHostname) {
      assert.equal(loginId, "property-manager");
      assert.equal(receivedHostname, hostname);
      return "property-manager@hotel.example.test";
    },
  });

  assert.deepEqual(result, { kind: "generic-login-failure" });
});

test("manager session is derived from a Neon authority projection", async () => {
  assert.equal(typeof requestAuthentication.resolveSessionWith, "function");

  const resolved = await requestAuthentication.resolveSessionWith({
    authUserId: "11111111-1111-4111-8111-111111111111",
    hostname,
    neon: fakeManagerAuthority(),
  });

  assert.equal(resolved.session.role, "property_ld_manager");
  assert.equal(resolved.tenantId, "tenant-a");
});

test("department administrator receives only Neon-authorized descendant scope", async () => {
  const resolved = await requestAuthentication.resolveSessionWith({
    authUserId: "11111111-1111-4111-8111-111111111111",
    hostname,
    neon: fakeDepartmentAuthority(),
  });

  assert.deepEqual(
    resolved.session.departmentScopes.map(scope => scope.departmentId),
    ["front-office"],
  );
});

test("refresh re-resolves Neon authority instead of retaining stale role facts", async () => {
  assert.equal(typeof requestAuthentication.resolveRequestWithRefresh, "function");
  const result = await requestAuthentication.resolveRequestWithRefresh({
    hostname,
    accessToken: "expired-access",
    refreshToken: "refresh-token",
    auth: authOnlyClient({ initialUser: null, refreshedUserId: "11111111-1111-4111-8111-111111111111" }),
    neon: fakeUnauthorizedAuthority(),
  });

  assert.equal(result, null);
});

test("hostname property mismatch produces no authenticated business session", async () => {
  const resolved = await requestAuthentication.resolveSessionWith({
    authUserId: "11111111-1111-4111-8111-111111111111",
    hostname,
    neon: fakeCrossPropertyAuthority(),
  });

  assert.equal(resolved.session.authenticated, false);
});

test("property manager authorization keeps the private Neon tenant and property scope together", async () => {
  assert.equal(typeof productionAuthorization.requirePropertyManagerWith, "function");

  const actor = await productionAuthorization.requirePropertyManagerWith(fakeNeonManagerRequest());

  assert.deepEqual(
    { tenantId: actor.tenantId, propertyId: actor.propertyId },
    { tenantId: "tenant-a", propertyId: "property-a" },
  );
});

test("property manager authorization emits refreshed cookies with the supplied environment", async () => {
  const request = fakeNeonManagerRequest();
  request.environment.appEnv = "local";
  request.resolved.refreshed = true;

  const actor = await productionAuthorization.requirePropertyManagerWith(request);

  assert.equal(actor.refreshedCookies.length, 2);
  assert.equal(actor.refreshedCookies.every(cookie => !cookie.includes("; Secure")), true);
});

test("source gate requires the deterministic Neon contract and server-only resolver factories", () => {
  assert.deepEqual(validateAuthAuthorizationSplitSources({
    authenticationService: `
      const email = deriveDeterministicAuthEmail(loginId, hostname);
      export type { NeonAuthorizationFacts } from "../repositories/neon/authorization-session-repository.ts";
      export type NeonAuthorizationRepository = Readonly<{
        resolveAuthorizationForAuthUser(authUserId: string, hostname: string, requestId: string): Promise<NeonAuthorizationFacts>;
      }>;
      export function createLoginResolutionDependencies() {}
      export async function resolveLoginWith() {}
    `,
    requestAuthentication: `
      export function createSessionResolutionDependencies() {}
      export async function resolveSessionWith() {}
      export async function resolveAuthenticatedRequestWithAuthority() {}
    `,
    browserRegistry: "export type RuntimeDomainRegistry = {};",
    productionAuthorization: "",
    loginRoute: "",
    sessionRoute: "",
    initializationAccess: "",
  }), {
    deterministicLoginContract: true,
    neonAuthorizationContract: true,
    loginResolverFactory: true,
    sessionResolverFactory: true,
    serverOnlySupabaseBoundary: true,
    browserRegistryGate: true,
  });
});

test("source gate rejects Supabase business calls from active auth and control-plane sources", () => {
  const input = deterministicAuthorizationSourceFixture();

  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      authenticationService: `${input.authenticationService}\nclient.from("user_accounts")`,
    }),
    /SUPABASE_BUSINESS_AUTH_DRIFT/,
  );
  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      initializationAccess: 'admin.from("role_assignments")',
    }),
    /SUPABASE_BUSINESS_AUTH_DRIFT/,
  );
});

test("source gate fails closed for direct, optional, and aliased Supabase bypasses", () => {
  for (const { name, sourceName, appended, error } of [
    {
      name: "direct Supabase client imports",
      sourceName: "authenticationService",
      appended: 'import { createClient } from "@supabase/supabase-js"; createClient("url", "key");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "optional unsupported Auth methods",
      sourceName: "sessionRoute",
      appended: "client.auth?.signOut();",
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "optionally invoked unsupported Auth methods",
      sourceName: "sessionRoute",
      appended: "client.auth.signOut?.();",
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "destructured business methods",
      sourceName: "loginRoute",
      appended: 'const { from } = client; from("user_accounts");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "aliased business methods",
      sourceName: "productionAuthorization",
      appended: 'const { rpc: invoke } = client; invoke("business_operation");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "direct RPC calls",
      sourceName: "initializationAccess",
      appended: 'client.rpc("business_operation");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "computed from calls",
      sourceName: "loginRoute",
      appended: 'client["from"]("users");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "computed RPC calls",
      sourceName: "loginRoute",
      appended: 'client["rpc"]("operation");',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "browser Supabase client imports",
      sourceName: "requestAuthentication",
      appended: 'import { createBrowserClient } from "../lib/supabase/browser.ts";',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "legacy Supabase business repository imports",
      sourceName: "sessionRoute",
      appended: 'import { legacy } from "../repositories/supabase/auth-repository.ts";',
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "retired pre-auth lookup references",
      sourceName: "loginRoute",
      appended: "resolveLoginIdentity(hostname, loginId);",
      error: /RETIRED_PRE_AUTH_LOGIN_CONTRACT_DRIFT/,
    },
  ]) {
    const input = deterministicAuthorizationSourceFixture();
    assert.throws(
      () => validateAuthAuthorizationSplitSources({
        ...input,
        [sourceName]: `${input[sourceName]}\n${appended}`,
      }),
      error,
      name,
    );
  }
});

test("deterministic Auth email normalizes an existing valid login ID and trusted hostname", async (t) => {
  const identity = await isolatedDeterministicLoginIdentity(t);

  assert.equal(
    identity.deriveDeterministicAuthEmail("Property.Manager-01", "HOTEL.EXAMPLE.TEST"),
    "property.manager-01@hotel.example.test",
  );
  assert.equal(
    identity.deriveDeterministicAuthEmail("Manager_01", "LOCALHOST"),
    "manager_01@localhost",
  );
});

test("deterministic Auth email rejects invalid login IDs and untrusted hostname syntax", async (t) => {
  const identity = await isolatedDeterministicLoginIdentity(t);

  for (const invalidLoginId of ["ab", " user", "user ", "user name", "user@example", "用户01"]) {
    assert.throws(
      () => identity.deriveDeterministicAuthEmail(invalidLoginId, "hotel.example.test"),
      /DETERMINISTIC_AUTH_IDENTITY_INVALID/,
      invalidLoginId,
    );
  }
  for (const invalidHostname of [
    "hotel.example.test:443",
    "hotel.example.test/path",
    " hotel.example.test",
    "hotel .example.test",
    "hotel_example.test",
  ]) {
    assert.throws(
      () => identity.deriveDeterministicAuthEmail("property-manager", invalidHostname),
      /DETERMINISTIC_AUTH_IDENTITY_INVALID/,
      invalidHostname,
    );
  }
});

test("canonical authorization source rejects a missing exact entrypoint", () => {
  assert.equal(typeof canonicalValidator.validateCanonicalAuthAuthorizationSource, "function");
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(readAuthorizationFunction, ""),
    ),
    /AUTHORIZATION_ENTRYPOINT_MISSING/,
  );
});

test("canonical authorization source rejects PUBLIC execute and raw application privileges", () => {
  assert.equal(typeof canonicalValidator.validateCanonicalAuthAuthorizationSource, "function");
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(
        "grant execute on function public.read_neon_authorization_session(text) to hotel_ld_application;",
        "grant execute on function public.read_neon_authorization_session(text) to public;",
      ),
    ),
    /PUBLIC_EXECUTE/,
  );
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(
        "commit;",
        "grant select on table public.user_accounts to hotel_ld_application;\ncommit;",
      ),
    ),
    /RAW_APPLICATION_PRIVILEGE/,
  );
});

test("canonical authorization source requires fixed search paths, PUBLIC revokes, and exact grants", () => {
  assert.equal(typeof canonicalValidator.validateCanonicalAuthAuthorizationSource, "function");
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace("set search_path = ''", "set search_path = public"),
    ),
    /DEFINER_SEARCH_PATH/,
  );
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(
        "revoke all on function public.read_neon_authorization_session(text) from public;",
        "",
      ),
    ),
    /PUBLIC_REVOKE_MISSING/,
  );
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(
        "grant execute on function public.read_neon_authorization_session(text) to hotel_ld_application;",
        "grant execute on function public.read_neon_authorization_session(uuid) to hotel_ld_application;",
      ),
    ),
    /APPLICATION_EXECUTE_MISSING/,
  );
});

test("canonical authorization source rejects RLS policy changes", () => {
  assert.equal(typeof canonicalValidator.validateCanonicalAuthAuthorizationSource, "function");
  assert.throws(
    () => canonicalValidator.validateCanonicalAuthAuthorizationSource(
      authorizationSourceFixture().replace(
        "commit;",
        "create policy authorization_widening on public.user_accounts using (true);\ncommit;",
      ),
    ),
    /RLS_POLICY_CHANGE/,
  );
});

const readAuthorizationFunction = `
create function public.read_neon_authorization_session(p_hostname text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
begin
  if session_user <> 'hotel_ld_application' then return null; end if;
  return null;
end
$function$;
`;

function authorizationSourceFixture() {
  return `
begin;
set local role hotel_ld_migration_owner;
${readAuthorizationFunction}
revoke all on function public.read_neon_authorization_session(text) from public;
grant execute on function public.read_neon_authorization_session(text) to hotel_ld_application;
commit;
`;
}

async function isolatedDeterministicLoginIdentity(t) {
  const sourcePath = resolve("app/lib/auth/deterministic-login-identity.ts");
  const source = await readFile(sourcePath, "utf8").catch(() => null);
  assert.notEqual(source, null, "missing deterministic-login-identity.ts");
  assert.match(source, /^import ["']server-only["'];/);
  assert.doesNotMatch(source, /(?:supabase|createNeonPool|\.query\s*\(|\bfetch\s*\()/i);

  const root = await mkdtemp(join(tmpdir(), "deterministic-login-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "deterministic-login-identity.ts");
  await writeFile(target, source.replace(/^import ["']server-only["'];\s*/, ""));
  return import(`${pathToFileURL(target).href}?test=${Date.now()}`);
}

function fakeAuthSignIn({ signedInUserId, verifiedUserId }) {
  return {
    auth: {
      async signInWithPassword(input) {
        assert.deepEqual(input, { email: "property-manager@hotel.example.test", password });
        return {
          data: {
            user: { id: signedInUserId },
            session: { access_token: "access", refresh_token: "refresh" },
          },
          error: null,
        };
      },
      async getUser(accessToken) {
        assert.equal(accessToken, "access");
        return { data: { user: { id: verifiedUserId } } };
      },
    },
    from() {
      throw new Error("SUPABASE_BUSINESS_CALL_FORBIDDEN");
    },
    rpc() {
      throw new Error("SUPABASE_BUSINESS_CALL_FORBIDDEN");
    },
  };
}

function authOnlyClient({ initialUser = { id: "11111111-1111-4111-8111-111111111111" }, refreshedUserId } = {}) {
  return {
    auth: {
      async getUser(accessToken) {
        assert.equal(accessToken, "expired-access");
        return { data: { user: initialUser } };
      },
      async refreshSession(input) {
        assert.deepEqual(input, { refresh_token: "refresh-token" });
        return {
          data: refreshedUserId
            ? {
              user: { id: refreshedUserId },
              session: { access_token: "fresh-access", refresh_token: "fresh-refresh" },
            }
            : { user: null, session: null },
          error: null,
        };
      },
    },
    from() {
      throw new Error("SUPABASE_BUSINESS_CALL_FORBIDDEN");
    },
    rpc() {
      throw new Error("SUPABASE_BUSINESS_CALL_FORBIDDEN");
    },
  };
}

const managerSession = {
  authenticated: true,
  userId: "manager-id",
  displayName: "Manager",
  propertyId: "property-id",
  propertyNameZh: "酒店",
  propertyNameEn: "Hotel",
  propertyLogoUrl: null,
  role: "property_ld_manager",
  departmentScopes: [],
  mustChangePassword: false,
};

function fakeManagerAuthority() {
  return {
    async resolveAuthorizationForAuthUser(authUserId, receivedHostname) {
      assert.equal(authUserId, "11111111-1111-4111-8111-111111111111");
      assert.equal(receivedHostname, hostname);
      return { session: managerSession, tenantId: "tenant-a" };
    },
  };
}

function fakeDepartmentAuthority() {
  return {
    async resolveAuthorizationForAuthUser() {
      return {
        tenantId: "tenant-a",
        session: {
          ...managerSession,
          role: "department_training_responsible",
          departmentScopes: [{
            departmentId: "front-office",
            departmentNameZh: "前厅部",
            departmentNameEn: "Front Office",
            breadcrumb: ["房务部", "前厅部"],
            breadcrumbEn: ["Rooms", "Front Office"],
            includeDescendants: true,
          }],
        },
      };
    },
  };
}

function fakeUnauthorizedAuthority() {
  return {
    async resolveAuthorizationForAuthUser() {
      return { tenantId: null, session: { ...managerSession, authenticated: false, role: "unauthorized", propertyId: null } };
    },
  };
}

function fakeCrossPropertyAuthority() {
  return fakeUnauthorizedAuthority();
}

function fakeNeonManagerRequest() {
  return {
    hostname: "hotel.example.test",
    environment: { appEnv: "production", dataMode: "neon" },
    resolved: {
      session: { ...managerSession, propertyId: "property-a" },
      tenantId: "tenant-a",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      refreshed: false,
    },
  };
}

function deterministicAuthorizationSourceFixture() {
  return {
    authenticationService: `
      const email = deriveDeterministicAuthEmail(loginId, hostname);
      export type { NeonAuthorizationFacts } from "../repositories/neon/authorization-session-repository.ts";
      export type NeonAuthorizationRepository = Readonly<{
        resolveAuthorizationForAuthUser(authUserId: string, hostname: string, requestId: string): Promise<NeonAuthorizationFacts>;
      }>;
      export function createLoginResolutionDependencies() {}
      export async function resolveLoginWith() {}
    `,
    requestAuthentication: `
      export function createSessionResolutionDependencies() {}
      export async function resolveSessionWith() {}
      export async function resolveAuthenticatedRequestWithAuthority() {}
    `,
    browserRegistry: "export type RuntimeDomainRegistry = {};",
    productionAuthorization: "",
    loginRoute: "",
    sessionRoute: "",
    initializationAccess: "",
  };
}
