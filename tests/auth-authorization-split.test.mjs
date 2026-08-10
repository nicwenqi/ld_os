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

const hostname = "hotel.example.test";
const loginId = "property-manager";
const password = "HotelDemo2026";

test("login rejects a Supabase Auth user ID that differs from Neon identity", async () => {
  assert.equal(typeof authentication.resolveLoginWith, "function");

  const result = await authentication.resolveLoginWith({
    hostname,
    loginId,
    password,
    neon: fakeNeonIdentity("11111111-1111-4111-8111-111111111111"),
    auth: fakeAuthSignIn("22222222-2222-4222-8222-222222222222"),
  });

  assert.deepEqual(result, { kind: "generic-login-failure" });
});

test("session authority never invokes Supabase from or rpc", async () => {
  assert.equal(typeof requestAuthentication.resolveSessionWith, "function");

  const auth = authOnlyClient();
  const result = await requestAuthentication.resolveSessionWith({
    hostname,
    auth,
    neon: fakeManagerAuthority(),
  });

  assert.deepEqual(result, managerSession);
  assert.equal(auth.businessCalls, 0);
});

test("source gate requires the exported Neon contract and server-only resolver factories", () => {
  assert.deepEqual(validateAuthAuthorizationSplitSources({
    authenticationService: `
      export type NeonPreAuthLoginIdentity = Readonly<{ authUserId: string; email: string }>;
      export type NeonAuthorizationFacts = Readonly<{ session: AuthSession; tenantId: string | null }>;
      export type NeonAuthorizationRepository = Readonly<{
        resolveLoginIdentity(hostname: string, loginId: string): Promise<NeonPreAuthLoginIdentity | null>;
        readSessionAuthority(hostname: string): Promise<NeonAuthorizationFacts>;
      }>;
      export function createLoginResolutionDependencies() {}
      export async function resolveLoginWith() {}
    `,
    requestAuthentication: `
      export function createSessionResolutionDependencies() {}
      export async function resolveSessionWith() {}
    `,
    browserRegistry: "export type RuntimeDomainRegistry = {};",
  }), {
    neonAuthorizationContract: true,
    loginResolverFactory: true,
    sessionResolverFactory: true,
    browserRegistryGate: true,
  });
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

function fakeNeonIdentity(authUserId) {
  return {
    async resolveLoginIdentity(receivedHostname, receivedLoginId) {
      assert.equal(receivedHostname, hostname);
      assert.equal(receivedLoginId, loginId);
      return { authUserId, email: "manager@hotel.example.test" };
    },
    async readSessionAuthority() {
      throw new Error("SESSION_AUTHORITY_NOT_EXPECTED_DURING_LOGIN");
    },
  };
}

function fakeAuthSignIn(authUserId) {
  return {
    auth: {
      async signInWithPassword(input) {
        assert.deepEqual(input, { email: "manager@hotel.example.test", password });
        return {
          data: {
            user: { id: authUserId },
            session: { access_token: "access", refresh_token: "refresh" },
          },
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

function authOnlyClient() {
  return {
    businessCalls: 0,
    auth: {
      async getUser() {
        return { data: { user: { id: "11111111-1111-4111-8111-111111111111" } } };
      },
    },
    from() {
      this.businessCalls += 1;
      throw new Error("SUPABASE_BUSINESS_CALL_FORBIDDEN");
    },
    rpc() {
      this.businessCalls += 1;
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
    async resolveLoginIdentity() {
      throw new Error("LOGIN_IDENTITY_NOT_EXPECTED_DURING_SESSION_RESOLUTION");
    },
    async readSessionAuthority(receivedHostname) {
      assert.equal(receivedHostname, hostname);
      return { session: managerSession, tenantId: "tenant-id" };
    },
  };
}
