import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { validateAuthAuthorizationSplitSources } from "../scripts/neon/validate-auth-authorization-split.mjs";
import {
  allowedAuthSourceAuditCases,
  rejectedAuthSourceAuditCases,
} from "../scripts/neon/fixtures/auth-source-audit-cases.mjs";
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
  const refreshed = await requestAuthentication.resolveSessionWith({
    authUserId: "11111111-1111-4111-8111-111111111111",
    hostname,
    neon: fakeUnauthorizedAuthority(),
  });
  assert.equal(refreshed.session.authenticated, false);
  const source = await readFile(new URL("../app/services/request-authentication.ts", import.meta.url), "utf8");
  assert.match(source, /resolveBetterAuthIdentity/);
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

  assert.deepEqual(actor.refreshedCookies, ["better-auth.session_token=opaque; HttpOnly"]);
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
    serverOnlyIdentityBoundary: true,
    browserRegistryGate: true,
  });
});

test("source gate rejects Supabase business calls from active auth and control-plane sources", () => {
  const input = deterministicAuthorizationSourceFixture();

  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      authenticationService: `${input.authenticationService}\n${serverSupabaseClientSource('client.from("user_accounts")')}`,
    }),
    /SUPABASE_BUSINESS_AUTH_DRIFT/,
  );
  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      initializationAccess: serverSupabaseClientSource('admin.from("role_assignments")', "admin"),
    }),
    /SUPABASE_BUSINESS_AUTH_DRIFT/,
  );
});

test("source gate rejects a legacy Supabase Storage adapter in the active Import path", () => {
  const input = deterministicAuthorizationSourceFixture();
  const legacyStorageAdapter = `
    import "server-only";
    import { createServerActorClient } from "../lib/supabase/server-admin.ts";
    const identity = { accessToken: "access-token" };
    const storage = createActorStorageGateway(createServerActorClient(identity.accessToken));
    export function createActorStorageGateway(client) {
      return {
        async upload() { await client.storage.from("property-import-files").upload("path", new Uint8Array(), {}); },
        async download() { return client.storage.from("property-import-files").download("path"); },
        async remove() { return client.storage.from("property-import-files").remove(["path"]); },
      };
    }
    operation({ storage });
  `;

  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      neonImportStagingAuthorization: legacyStorageAdapter,
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
      name: "direct unsupported Auth methods",
      sourceName: "sessionRoute",
      appended: serverSupabaseClientSource("client.auth.signOut();"),
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "optional unsupported Auth methods",
      sourceName: "sessionRoute",
      appended: serverSupabaseClientSource("client.auth?.signOut();"),
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "optionally invoked unsupported Auth methods",
      sourceName: "sessionRoute",
      appended: serverSupabaseClientSource("client.auth.signOut?.();"),
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "destructured business methods",
      sourceName: "loginRoute",
      appended: serverSupabaseClientSource('const { from } = client; from("user_accounts");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "aliased business methods",
      sourceName: "productionAuthorization",
      appended: serverSupabaseClientSource('const { rpc: invoke } = client; invoke("business_operation");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "assigned business methods",
      sourceName: "productionAuthorization",
      appended: serverSupabaseClientSource('const select = client.from; select("user_accounts");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "computed destructured business methods",
      sourceName: "productionAuthorization",
      appended: serverSupabaseClientSource('const { ["from"]: select } = client; select("user_accounts");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "assigned computed destructured business methods",
      sourceName: "productionAuthorization",
      appended: serverSupabaseClientSource('let invoke; ({ ["rpc"]: invoke } = client); invoke("business_operation");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "assigned destructured Auth clients",
      sourceName: "sessionRoute",
      appended: serverSupabaseClientSource("let auth; ({ auth } = client); auth.signOut();"),
      error: /SUPABASE_AUTH_METHOD_DRIFT/,
    },
    {
      name: "direct RPC calls",
      sourceName: "initializationAccess",
      appended: serverSupabaseClientSource('client.rpc("business_operation");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "computed from calls",
      sourceName: "loginRoute",
      appended: serverSupabaseClientSource('client["from"]("users");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "computed RPC calls",
      sourceName: "loginRoute",
      appended: serverSupabaseClientSource('client["rpc"]("operation");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "optional computed from calls",
      sourceName: "loginRoute",
      appended: serverSupabaseClientSource('client?.["from"]("users");'),
      error: /SUPABASE_BUSINESS_AUTH_DRIFT/,
    },
    {
      name: "optional computed RPC calls",
      sourceName: "loginRoute",
      appended: serverSupabaseClientSource('client?.["rpc"]("operation");'),
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

test("source gate permits benign from labels and methods on a non-Supabase receiver", () => {
  const input = deterministicAuthorizationSourceFixture();

  assert.doesNotThrow(() => validateAuthAuthorizationSplitSources({
    ...input,
    loginRoute: `
      const labels = ["from"];
      const client = { from() { return labels; } };
      client.from();
    `,
  }));
});

test("source gate rejects a Supabase factory alias assigned after declaration", () => {
  const input = deterministicAuthorizationSourceFixture();

  assert.throws(
    () => validateAuthAuthorizationSplitSources({
      ...input,
      loginRoute: `
        import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
        let make;
        make = createServerPasswordClient;
        const client = make();
        client.from("users");
      `,
    }),
    /SUPABASE_BUSINESS_AUTH_DRIFT/,
  );
});

test("source gate permits a shadowed non-Supabase receiver binding", () => {
  const input = deterministicAuthorizationSourceFixture();

  assert.doesNotThrow(() => validateAuthAuthorizationSplitSources({
    ...input,
    loginRoute: `
      import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
      const client = createServerPasswordClient();
      function readLocalRows() {
        const client = { from() {} };
        client.from();
      }
      client.auth.getUser("access-token");
    `,
  }));
});

test("source gate tracks server factories through namespace aliases and extraction", () => {
  const input = deterministicAuthorizationSourceFixture();
  const escaped = [];

  for (const { name, source } of [
    {
      name: "namespace alias",
      source: `
        import * as serverAdmin from "../lib/supabase/server-admin.ts";
        const alias = serverAdmin;
        alias.createServerActorClient().rpc("operation");
      `,
    },
    {
      name: "namespace factory extraction",
      source: `
        import * as serverAdmin from "../lib/supabase/server-admin.ts";
        const { createServerPasswordClient: make } = serverAdmin;
        make().from("users");
      `,
    },
    {
      name: "assigned namespace factory extraction",
      source: `
        import * as serverAdmin from "../lib/supabase/server-admin.ts";
        let make;
        ({ createServerAdminClient: make } = serverAdmin);
        make().from("users");
      `,
    },
    {
      name: "direct dynamic import factory",
      source: `
        (await import("../lib/supabase/server-admin.ts"))
          .createServerPasswordClient()
          .rpc("operation");
      `,
    },
    {
      name: "assigned dynamic import factory extraction",
      source: `
        let make;
        ({ createServerActorClient: make } = await import("../lib/supabase/server-admin.ts"));
        make().from("users");
      `,
    },
  ]) {
    try {
      validateAuthAuthorizationSplitSources({ ...input, loginRoute: source });
      escaped.push(name);
    } catch (error) {
      assert.match(error.message, /SUPABASE_BUSINESS_AUTH_DRIFT/, name);
    }
  }

  assert.deepEqual(escaped, []);
});

test("source gate tracks factory-derived clients in object, class, and parameter bindings", () => {
  const input = deterministicAuthorizationSourceFixture();
  const escaped = [];

  for (const { name, statement } of [
    {
      name: "object property client",
      statement: 'const holder = { client: createServerPasswordClient() }; holder.client.from("users");',
    },
    {
      name: "object property factory",
      statement: 'const holder = { make: createServerPasswordClient }; holder.make().rpc("operation");',
    },
    {
      name: "class field client",
      statement: 'class Repository { client = createServerPasswordClient(); read() { return this.client.from("users"); } }',
    },
    {
      name: "default parameter client",
      statement: 'function read(client = createServerPasswordClient()) { return client.rpc("operation"); }',
    },
  ]) {
    const source = `
      import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
      ${statement}
    `;
    try {
      validateAuthAuthorizationSplitSources({ ...input, loginRoute: source });
      escaped.push(name);
    } catch (error) {
      assert.match(error.message, /SUPABASE_BUSINESS_AUTH_DRIFT/, name);
    }
  }

  assert.deepEqual(escaped, []);
});

test("source gate rejects every fixture whose Supabase provenance reaches a forbidden surface", () => {
  const input = deterministicAuthorizationSourceFixture();
  const escaped = [];

  for (const fixture of rejectedAuthSourceAuditCases) {
    try {
      validateAuthAuthorizationSplitSources({
        ...input,
        [fixture.sourceName ?? "loginRoute"]: fixture.source,
      });
      escaped.push(fixture.name);
    } catch (error) {
      assert.match(error.message, new RegExp(fixture.error), fixture.name);
    }
  }

  assert.deepEqual(escaped, []);
});

test("source gate permits approved Auth and Storage surfaces plus binding-aware local shadows", () => {
  const input = deterministicAuthorizationSourceFixture();
  const rejected = [];

  for (const fixture of allowedAuthSourceAuditCases) {
    try {
      validateAuthAuthorizationSplitSources({
        ...input,
        [fixture.sourceName ?? "loginRoute"]: fixture.source,
      });
    } catch (error) {
      rejected.push({ name: fixture.name, message: error.message });
    }
  }

  assert.deepEqual(rejected, []);
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
  const corePath = resolve("app/lib/auth/deterministic-login-identity-core.ts");
  const source = await readFile(sourcePath, "utf8").catch(() => null);
  const core = await readFile(corePath, "utf8").catch(() => null);
  assert.notEqual(source, null, "missing deterministic-login-identity.ts");
  assert.notEqual(core, null, "missing deterministic-login-identity-core.ts");
  assert.match(source, /^import ["']server-only["'];/);
  assert.doesNotMatch(source, /(?:supabase|createNeonPool|\.query\s*\(|\bfetch\s*\()/i);

  const root = await mkdtemp(join(tmpdir(), "deterministic-login-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "deterministic-login-identity.ts");
  await writeFile(join(root, "deterministic-login-identity-core.ts"), core);
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
      refreshedCookies: ["better-auth.session_token=opaque; HttpOnly"],
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

function serverSupabaseClientSource(statement, receiver = "client") {
  return `
    import { createServerPasswordClient } from "../lib/supabase/server-admin.ts";
    const ${receiver} = createServerPasswordClient();
    ${statement}
  `;
}
