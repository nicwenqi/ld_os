#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CANONICAL = join(ROOT, "neon/canonical");
const MODULE = join(CANONICAL, "080_property_initialization.sql");

export const PROPERTY_TABLES = Object.freeze([
  "public.property_settings",
  "public.property_initialization_steps",
  "app_private.property_read_audit_events",
  "app_private.property_write_audit_events",
  "app_private.initialization_audit_events",
]);

export const PROPERTY_ENTRYPOINT_SIGNATURES = Object.freeze([
  "public.resolve_neon_property_context(text)",
  "public.read_neon_property(text)",
  "public.save_neon_property_identity(text,timestamptz,text,text,text,text,text,text,text,text,text)",
  "public.save_neon_property_settings(text,bigint,smallint,text,text,boolean,boolean)",
  "public.get_neon_initialization_progress(text)",
  "public.save_neon_initialization_navigation(text,smallint,bigint)",
  "public.save_neon_initialization_step(text,text,smallint,boolean,text,text,bigint)",
  "public.complete_neon_initialization(text,bigint)",
  "public.read_neon_initialization_access_summary(text)",
]);

const PUBLIC_FUNCTIONS = PROPERTY_ENTRYPOINT_SIGNATURES.map(value => value.split("(")[0]);

export async function validateCanonicalPropertyAuthority({ root = ROOT } = {}) {
  const canonicalRoot = join(root, "neon/canonical");
  const source = await readFile(join(canonicalRoot, "080_property_initialization.sql"), "utf8");
  const manifest = JSON.parse(await readFile(join(canonicalRoot, "manifest.json"), "utf8"));
  const modules = manifest.modules.map(module => module.path);
  if (!modules.includes("080_property_initialization.sql")) fail("CANONICAL_PROPERTY_MODULE_MISSING");
  if (modules.indexOf("080_property_initialization.sql") <= modules.indexOf("070_security_postflight.sql")) fail("CANONICAL_PROPERTY_MODULE_ORDER");

  for (const table of PROPERTY_TABLES) {
    if (!new RegExp(`create\\s+table\\s+${escape(table)}`, "i").test(source)) fail("CANONICAL_PROPERTY_TABLE_MISSING", table);
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+enable\\s+row\\s+level\\s+security`, "i").test(source)) fail("CANONICAL_PROPERTY_RLS_MISSING", table);
    if (!new RegExp(`alter\\s+table\\s+${escape(table)}\\s+force\\s+row\\s+level\\s+security`, "i").test(source)) fail("CANONICAL_PROPERTY_FORCE_RLS_MISSING", table);
  }

  for (const signature of PROPERTY_ENTRYPOINT_SIGNATURES) {
    const [qualified] = signature.split("(");
    const routine = routineSource(source, qualified);
    if (!/security definer/i.test(routine) || !/set search_path\s*=\s*''/i.test(routine)) fail("CANONICAL_PROPERTY_ENTRYPOINT_SECURITY", signature);
    if (!new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${escape(signature)}\\s+from\\s+public`, "i").test(source)) fail("CANONICAL_PROPERTY_PUBLIC_REVOKE_MISSING", signature);
    if (!new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escape(signature)}\\s+to\\s+hotel_ld_application`, "i").test(source)) fail("CANONICAL_PROPERTY_APPLICATION_GRANT_MISSING", signature);
  }

  if (/grant\s+(?:select|insert|update|delete|all)\s+on\s+(?:table\s+)?(?:public|app_private)\./i.test(source)) fail("CANONICAL_PROPERTY_RAW_GRANT");
  if (/\b(?:auth\.|storage\.|import_|supabase)/i.test(source)) fail("CANONICAL_PROPERTY_LEGACY_DEPENDENCY");
  if (!/initialization_state\s*=\s*'ready'/.test(source) || !/NEON_INITIALIZATION_VERSION_CONFLICT/.test(source)) fail("CANONICAL_PROPERTY_INITIALIZATION_GUARDS");

  const registry = await readFile(join(root, "app/repositories/runtime/neon-domain-registry.ts"), "utf8");
  const propertyHttp = await readFile(join(root, "app/repositories/http/property-repository.ts"), "utf8");
  const initializationHttp = await readFile(join(root, "app/repositories/http/initialization-repository.ts"), "utf8");
  for (const [name, text] of [["registry", registry], ["property-http", propertyHttp], ["initialization-http", initializationHttp]]) {
    if (/DATABASE_URL|createNeonPool|from\s+['"]pg['"]|NEON_ENDPOINT_ID/.test(text)) fail("CANONICAL_PROPERTY_BROWSER_SECRET", name);
  }
  if (!/createHttpPropertyRepository/.test(registry) || !/createHttpInitializationRepository/.test(registry)) fail("CANONICAL_PROPERTY_REGISTRY_WIRING");
  if (!/credentials:\s*["']same-origin["']/.test(propertyHttp) || !/credentials:\s*["']same-origin["']/.test(initializationHttp)) fail("CANONICAL_PROPERTY_HTTP_BOUNDARY");

  return { module: "080_property_initialization.sql", tables: PROPERTY_TABLES.length, entrypoints: PROPERTY_ENTRYPOINT_SIGNATURES.length, storageBoundary: "no-branding-object-storage", importAuthority: "excluded" };
}

function routineSource(source, qualifiedName) {
  const marker = new RegExp(`create\\s+function\\s+${escape(qualifiedName)}\\s*\\(`, "i");
  const match = marker.exec(source);
  if (!match) fail("CANONICAL_PROPERTY_ENTRYPOINT_MISSING", qualifiedName);
  const start = match.index;
  const next = /\ncreate\s+function\s+/gi;
  next.lastIndex = start + match[0].length;
  const following = next.exec(source);
  return source.slice(start, following ? following.index : source.length);
}

function escape(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function fail(code, value = "") { throw new Error(`${code}${value ? `: ${value}` : ""}`); }

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await validateCanonicalPropertyAuthority())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
