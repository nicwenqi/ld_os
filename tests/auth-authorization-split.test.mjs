import assert from "node:assert/strict";
import test from "node:test";

import { validateAuthAuthorizationSplitSources } from "../scripts/neon/validate-auth-authorization-split.mjs";

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
