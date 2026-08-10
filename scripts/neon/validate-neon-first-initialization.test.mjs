import assert from "node:assert/strict";
import test from "node:test";
import { validateNeonFirstInitializationSource } from "./validate-neon-first-initialization.mjs";

const cleanSources = {
  contract: "export function validateInitializationTarget() { return true; }",
  operator: "export async function initializeNeonFirstEnvironment() { return true; }",
  cli: "export function parseInitializationArgs() { return true; }",
};

test("source gate rejects runtime authorization bypasses and Auth provider coupling", () => {
  assert.equal(validateNeonFirstInitializationSource(cleanSources), true);
  assert.equal(validateNeonFirstInitializationSource({ ...cleanSources, operator: "set local role hotel_ld_migration_owner" }), false);
  assert.equal(validateNeonFirstInitializationSource({ ...cleanSources, cli: "import { createClient } from '@supabase/supabase-js'" }), false);
  assert.equal(validateNeonFirstInitializationSource({ ...cleanSources, operator: "grant select on public.employees to hotel_ld_application" }), false);
  assert.equal(validateNeonFirstInitializationSource({ ...cleanSources, cli: "import route from '../../app/api/import/route.ts'" }), false);
});
