#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const VALID_MODES = new Set(["source", "dry-run", "apply", "catalog", "runtime", "repeatability"]);
const DATABASE_MODES = new Set(["dry-run", "apply", "catalog", "runtime", "repeatability"]);
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../neon/canonical");
const IDENTIFIER = "[a-z_][a-z0-9_]*";

export class CanonicalNeonValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanonicalNeonValidationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new CanonicalNeonValidationError(code, message);
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeIdentifier(value) {
  return value.toLowerCase().replace(/"/g, "");
}

function orderedUnique(values) {
  return [...new Set(values)].sort();
}

function asStringArray(manifest, key) {
  if (!Array.isArray(manifest[key]) || manifest[key].some((value) => typeof value !== "string")) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", `manifest.${key} must be a string array`);
  }
  return manifest[key].map(normalizeIdentifier);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function loadManifest(root) {
  const path = join(root, "manifest.json");
  if (!(await exists(path))) fail("CANONICAL_NEON_MISSING_MANIFEST", `missing canonical manifest: ${path}`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", `cannot parse canonical manifest: ${error.message}`);
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "manifest must be a JSON object");
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "manifest.modules must be a non-empty array");
  }
  const modules = manifest.modules.map((module) => ({ order: module?.order, path: module?.path }));
  if (modules.some(({ order, path }) => !Number.isInteger(order) || typeof path !== "string" || !/^[a-z0-9_]+\.sql$/.test(path))) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "each manifest module needs an integer order and local SQL path");
  }
  for (let index = 1; index < modules.length; index += 1) {
    if (modules[index - 1].order >= modules[index].order) {
      fail("CANONICAL_NEON_MODULE_ORDER", "manifest module inventory must be strictly ordered");
    }
  }
  for (const key of ["schemas", "roles", "types", "tables", "routines", "entrypoints", "policies", "triggers"]) {
    asStringArray(manifest, key);
  }
  if (!manifest.exclusions || typeof manifest.exclusions !== "object" || Array.isArray(manifest.exclusions)) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "manifest.exclusions must explicitly classify excluded surface");
  }
  if (!Array.isArray(manifest.exclusions.schemas) || !Array.isArray(manifest.exclusions.objects) || !Array.isArray(manifest.exclusions.capabilities)) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "manifest.exclusions must include schemas, objects, and capabilities");
  }
  return modules;
}

function collect(source, expression) {
  return orderedUnique([...source.matchAll(expression)].map((match) => normalizeIdentifier(match[1])));
}

function objectInventory(source) {
  return {
    schemas: collect(source, new RegExp(`\\bcreate\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?(${IDENTIFIER})`, "gi")),
    roles: collect(source, new RegExp(`\\bcreate\\s+role\\s+(${IDENTIFIER})`, "gi")),
    types: collect(source, new RegExp(`\\bcreate\\s+type\\s+(?:if\\s+not\\s+exists\\s+)?((${IDENTIFIER})\\.(${IDENTIFIER})|${IDENTIFIER})`, "gi")),
    tables: collect(source, new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?((${IDENTIFIER})\\.(${IDENTIFIER})|${IDENTIFIER})`, "gi")),
    routines: collect(source, new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+((${IDENTIFIER})\\.(${IDENTIFIER})|${IDENTIFIER})`, "gi")),
    policies: collect(source, new RegExp(`\\bcreate\\s+policy\\s+(${IDENTIFIER})`, "gi")),
    triggers: collect(source, new RegExp(`\\bcreate\\s+(?:constraint\\s+)?trigger\\s+(${IDENTIFIER})`, "gi")),
  };
}

function compareInventory(kind, actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const extra = actual.filter((value) => !expectedSet.has(value));
  const missing = expected.filter((value) => !actualSet.has(value));
  if (extra.length || missing.length) {
    fail(
      "CANONICAL_NEON_MANIFEST_DRIFT",
      `${kind} drift (extra: ${extra.join(",") || "none"}; missing: ${missing.join(",") || "none"})`,
    );
  }
}

function stripDollarQuotedBlocks(source) {
  return source.replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "");
}

function functionBlocks(source) {
  const starts = [...source.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\b/gi)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function rejectUnsafeSource(source, manifest) {
  const exclusions = [
    ...manifest.exclusions.schemas,
    ...manifest.exclusions.objects,
  ].map((value) => String(value).toLowerCase());
  const forbiddenSchema = /\b(?:create|alter|grant\s+usage\s+on)\s+schema\s+(?:if\s+not\s+exists\s+)?(?:auth|storage|extensions|supabase_functions)\b|\b(?:auth|storage)\s*\./i;
  if (/\bauth\s*\.\s*(?:uid|users)\b/i.test(source)) fail("CANONICAL_NEON_FORBIDDEN_TOKEN", "canonical baseline cannot use auth.uid() or auth.users");
  if (forbiddenSchema.test(source)) fail("CANONICAL_NEON_FORBIDDEN_SCHEMA", "canonical baseline cannot contain a Supabase schema or reference");
  if (/(?:\bcreate\s+(?:table|function|type|role)|\bcreate\s+(?:constraint\s+)?trigger|\bcreate\s+policy)\s+[^;\n]*(?:import|provenance|history|audit(?:_events)?|compatibility|bridge|reset|test_user|test_data)\b/i.test(source)) {
    fail("CANONICAL_NEON_FORBIDDEN_OBJECT", "canonical baseline contains an explicitly excluded object");
  }
  if (/\bgrant\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:function|all\s+functions)[^;]*\bto\s+public\b/i.test(source)) {
    fail("CANONICAL_NEON_PUBLIC_EXECUTE", "PUBLIC EXECUTE is forbidden");
  }
  if (/(?:\bcreate|\balter)\s+role\s+(?:authenticated|anon|service_role|postgres|supabase_admin|dashboard_user)\b|\bgrant\b[^;]*\bto\s+(?:authenticated|anon|service_role)\b/i.test(source)) {
    fail("CANONICAL_NEON_BROAD_COMPATIBILITY_ROLE", "canonical baseline cannot create or grant to broad compatibility roles");
  }
  if (/(?:^|;)\s*set\s+(?!local\b)/i.test(source)) fail("CANONICAL_NEON_PERSISTENT_SET", "persistent session SET is forbidden; Actor Context must be transaction-local");
  if (/\bgrant\s+(?:all(?:\s+privileges)?|(?:(?:select|insert|update|delete|truncate|references|trigger)\s*,?\s*))+\s+on\s+(?:table\s+)?(?:public\.)?[a-z_][a-z0-9_]*(?:\s*,\s*(?:public\.)?[a-z_][a-z0-9_]*)*\s+to\s+hotel_ld_application\b/i.test(source)) {
    fail("CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE", "hotel_ld_application cannot receive raw business-table privileges");
  }
  const topLevel = stripDollarQuotedBlocks(source);
  if (/\b(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?public\.[a-z_][a-z0-9_]*/i.test(topLevel)) {
    fail("CANONICAL_NEON_BUSINESS_SEED_DML", "business seed DML is forbidden in the canonical bootstrap");
  }
  for (const block of functionBlocks(source)) {
    if (/\bsecurity\s+definer\b/i.test(block) && !/\bset\s+search_path\s*=\s*''/i.test(block)) {
      fail("CANONICAL_NEON_DEFINER_SEARCH_PATH", "SECURITY DEFINER routines require fixed search_path = ''");
    }
  }
  if (exclusions.some((token) => token === "auth.uid" && /\bauth\.uid\s*\(/i.test(source))) {
    fail("CANONICAL_NEON_FORBIDDEN_TOKEN", "canonical exclusions forbid auth.uid()");
  }
}

function requireForceRls(source, tables) {
  for (const table of tables) {
    const pattern = new RegExp(`\\balter\\s+table\\s+(?:only\\s+)?${escaped(table)}\\s+force\\s+row\\s+level\\s+security\\s*;`, "i");
    if (!pattern.test(source)) fail("CANONICAL_NEON_FORCE_RLS_REQUIRED", `missing FORCE ROW LEVEL SECURITY for ${table}`);
  }
}

export async function validateCanonicalNeonSource({ root = DEFAULT_ROOT } = {}) {
  const canonicalRoot = resolve(root);
  const manifest = await loadManifest(canonicalRoot);
  const modules = validateManifest(manifest);
  const declaredModules = new Set(modules.map(({ path }) => path));
  const sqlFiles = (await readdir(canonicalRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name);
  const unlistedModules = sqlFiles.filter((path) => !declaredModules.has(path));
  if (unlistedModules.length) {
    fail("CANONICAL_NEON_MODULE_INVENTORY_DRIFT", `SQL modules missing from ordered manifest inventory: ${unlistedModules.join(", ")}`);
  }
  const missingPaths = [];
  for (const module of modules) if (!(await exists(join(canonicalRoot, module.path)))) missingPaths.push(module.path);
  if (missingPaths.length) {
    fail("CANONICAL_NEON_MISSING_MODULE", `canonical module inventory is incomplete: ${missingPaths.join(", ")}`);
  }
  const sources = await Promise.all(modules.map(({ path }) => readFile(join(canonicalRoot, path), "utf8")));
  const source = sources.join("\n");
  rejectUnsafeSource(source, manifest);
  const actual = objectInventory(source);
  for (const kind of ["roles", "types", "tables", "routines", "policies", "triggers"]) {
    compareInventory(kind, actual[kind], asStringArray(manifest, kind));
  }
  if (manifest.security?.requireForceRls) requireForceRls(source, asStringArray(manifest, "tables"));
  return {
    mode: "source",
    modules: modules.map(({ path }) => path),
    objects: Object.fromEntries(["policies", "routines", "tables", "triggers", "types"].map((kind) => [kind, actual[kind].length])),
  };
}

export async function validateCanonicalNeon({ mode = "source", root = DEFAULT_ROOT } = {}) {
  if (!VALID_MODES.has(mode)) fail("CANONICAL_NEON_UNKNOWN_MODE", `unknown mode: ${mode}`);
  if (DATABASE_MODES.has(mode)) {
    fail("CANONICAL_NEON_DATABASE_VALIDATION_UNAVAILABLE", `${mode} is fail-closed until Task 3 validates the independent Neon PostgreSQL 18 environment`);
  }
  return validateCanonicalNeonSource({ root });
}

function parseCli(argv) {
  const [mode = "source", ...rest] = argv;
  let root = DEFAULT_ROOT;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--root" && rest[index + 1]) {
      root = rest[index + 1];
      index += 1;
    } else {
      fail("CANONICAL_NEON_INVALID_ARGUMENT", `unknown argument: ${rest[index]}`);
    }
  }
  return { mode, root };
}

async function main() {
  try {
    const result = await validateCanonicalNeon(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof CanonicalNeonValidationError ? error.code : "CANONICAL_NEON_VALIDATION_FAILED";
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
