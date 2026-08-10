import assert from "node:assert/strict";
import test from "node:test";

import {
  validateRuntimeFinalCutoverSources,
} from "./validate-runtime-final-cutover.mjs";

const valid = {
  loader: `fetch("/api/runtime/rehearsal-mode"); import("./neon-domain-registry.ts"); import("./supabase-domain-registry.ts"); return loaders.createNeon();`,
  neonRegistry: `createHttpDepartmentRepository(); createHttpEmployeeRepository(); createHttpPositionRepository(); createHttpPropertyRepository(); createHttpInitializationRepository(); createHttpImportRepository();`,
  pages: [
    `RuntimeDomainRegistryBoundary`,
    `useRuntimeDomainRegistry()`,
  ],
  modePayload: {
    source: "neon",
    domains: {
      organization: "neon", people: "neon", position: "neon", employee: "neon",
      import: "neon", property: "neon", initialization: "neon",
    },
  },
  modeSource: "resolveRuntimeDomainSelection",
  route: "resolveRuntimeDomainSelection",
  clientAssets: ["same-origin-http-only"],
};

test("cutover source gate accepts one complete Neon source without browser credentials", () => {
  assert.deepEqual(validateRuntimeFinalCutoverSources(valid), {
    source: "neon",
    allDomainsSameSource: true,
    supabaseBusinessClient: false,
    browserNeonCredential: false,
  });
});

test("cutover source gate rejects direct factories and Supabase business clients in a browser consumer", () => {
  assert.throws(
    () => validateRuntimeFinalCutoverSources({
      ...valid,
      pages: [...valid.pages, "createRepositoryRegistry()"],
    }),
    /DIRECT_REGISTRY_DRIFT/,
  );
  assert.throws(
    () => validateRuntimeFinalCutoverSources({
      ...valid,
      pages: [...valid.pages, "createBrowserSupabaseClient()"],
    }),
    /SUPABASE_BUSINESS_CLIENT_DRIFT/,
  );
});

test("cutover source gate rejects a mixed domain matrix and browser Neon credential", () => {
  assert.throws(
    () => validateRuntimeFinalCutoverSources({
      ...valid,
      modePayload: {
        ...valid.modePayload,
        domains: { ...valid.modePayload.domains, import: "supabase" },
      },
    }),
    /DOMAIN_SOURCE_MATRIX_DRIFT/,
  );
  assert.throws(
    () => validateRuntimeFinalCutoverSources({
      ...valid,
      clientAssets: ["DATABASE_URL=postgresql://forbidden"],
    }),
    /BROWSER_NEON_SECRET_DRIFT/,
  );
});
