#!/usr/bin/env node

import { fileURLToPath } from "node:url";

/**
 * Deterministic, provider-neutral rehearsal fixture for E5E.  This file is a
 * manifest, not a migration and it never creates an Auth user or contacts a
 * database.  A staging-only seeder may consume it after resolving the manager
 * authUserId through the configured Auth provider.
 */

export const E5E_DEVELOPMENT_SEED = Object.freeze({
  source: "e5e-canonical-development-fixture",
  auth: Object.freeze({
    managerAuthUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    note: "identity must be provisioned by the existing Auth adapter; this fixture never writes Auth",
  }),
  tenant: Object.freeze({
    id: "11111111-1111-4111-8111-111111111111",
    slug: "e5e-demo-tenant",
    name: "E5E Demo Tenant",
  }),
  property: Object.freeze({
    id: "22222222-2222-4222-8222-222222222222",
    hostname: "e5e-demo.example.test",
    name: "E5E Demo Hotel",
  }),
  department: Object.freeze({
    id: "33333333-3333-4333-8333-333333333333",
    code: "OPS",
    nameZh: "运营部",
  }),
  positionFamily: Object.freeze({
    id: "44444444-4444-4444-8444-444444444444",
    code: "OPS-FAMILY",
    name: "Operations",
  }),
  position: Object.freeze({
    id: "55555555-5555-4555-8555-555555555555",
    code: "OPS-001",
    title: "Operations Manager",
  }),
  employees: Object.freeze({
    existing: Object.freeze({
      id: "66666666-6666-4666-8666-666666666666",
      employeeNumber: "E5E-001",
      externalIdentifier: "e5e-existing",
    }),
    newEmployee: Object.freeze({
      id: "77777777-7777-4777-8777-777777777777",
      employeeNumber: "E5E-002",
      externalIdentifier: "e5e-new",
    }),
    conflict: Object.freeze({
      id: "88888888-8888-4888-8888-888888888888",
      employeeNumber: "E5E-003",
      externalIdentifier: "e5e-existing",
    }),
  }),
  scenarios: Object.freeze([
    "employee_insert",
    "employee_update_expected_version",
    "external_identifier_conflict",
    "guarded_revert_after_commit",
  ]),
});

export function renderSeedManifest(seed = E5E_DEVELOPMENT_SEED) {
  return `${JSON.stringify(seed, null, 2)}\n`;
}

export function assertSeedTarget(input = {}) {
  if (input.production === true || input.supabase === true || input.legacyImport === true) {
    throw new Error("E5E_SEED_TARGET_FORBIDDEN");
  }
  if (input.apply === true) {
    throw new Error("E5E_SEED_APPLY_REQUIRES_STAGING_ONLY_SEEDER");
  }
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assertSeedTarget({ apply: process.argv.includes("--apply") });
    process.stdout.write(renderSeedManifest());
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : "E5E_SEED_FAILED");
    process.exitCode = 1;
  }
}
