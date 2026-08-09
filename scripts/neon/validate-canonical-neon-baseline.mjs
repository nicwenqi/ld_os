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
  for (const key of ["schemas", "roles", "types", "tables", "routines", "entrypoints", "entrypointSignatures", "policies", "triggers"]) {
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

function stripSqlComments(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("--", index)) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith("/*", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth > 0) {
        if (source.startsWith("/*", index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith("*/", index)) {
          depth -= 1;
          index += 2;
        } else index += 1;
      }
      if (depth !== 0) fail("CANONICAL_NEON_INVALID_SQL_COMMENT", "unterminated block comment");
      continue;
    }
    if (source[index] === "'") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") index += 2;
        else if (source[index++] === "'") break;
      }
      output += source.slice(start, index);
      continue;
    }
    const dollar = source.slice(index).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dollar) {
      const delimiter = dollar[0];
      const end = source.indexOf(delimiter, index + delimiter.length);
      const finish = end === -1 ? source.length : end + delimiter.length;
      output += source.slice(index, finish);
      index = finish;
      continue;
    }
    output += source[index++];
  }
  return output;
}

function normalizeQuotedIdentifiers(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    if (source[index] === "'") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") index += 2;
        else if (source[index++] === "'") break;
      }
      output += source.slice(start, index);
      continue;
    }
    const dollar = source.slice(index).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
    if (dollar) {
      const delimiter = dollar[0];
      const end = source.indexOf(delimiter, index + delimiter.length);
      const finish = end === -1 ? source.length : end + delimiter.length;
      output += source.slice(index, finish);
      index = finish;
      continue;
    }
    if (/^[uU]&"/.test(source.slice(index))) {
      const start = index;
      index += 3;
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') index += 2;
        else if (source[index++] === '"') break;
      }
      if (source[index - 1] !== '"') fail("CANONICAL_NEON_INVALID_SQL_IDENTIFIER", "unterminated Unicode quoted identifier");
      output += source.slice(start, index);
      continue;
    }
    if (source[index] === '"') {
      const end = source.indexOf('"', index + 1);
      if (end === -1) fail("CANONICAL_NEON_INVALID_SQL_IDENTIFIER", "unterminated quoted identifier");
      const identifier = source.slice(index + 1, end).replace(/""/g, '"');
      output += /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier) ? identifier.toLowerCase() : source.slice(index, end + 1);
      index = end + 1;
      continue;
    }
    output += source[index++];
  }
  return output;
}

function escapeStringCharacter(source, index) {
  const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  const character = source[index + 1];
  if (character in simple) return { value: simple[character], end: index + 2 };
  const hexadecimal = source.slice(index + 1).match(/^x([0-9a-f]{1,2})/i);
  if (hexadecimal) return { value: String.fromCodePoint(Number.parseInt(hexadecimal[1], 16)), end: index + 1 + hexadecimal[0].length };
  const unicode = source.slice(index + 1).match(/^(?:u([0-9a-f]{4})|U([0-9a-f]{8}))/);
  if (unicode) return { value: String.fromCodePoint(Number.parseInt(unicode[1] ?? unicode[2], 16)), end: index + 1 + unicode[0].length };
  const octal = source.slice(index + 1).match(/^([0-7]{1,3})/);
  if (octal) return { value: String.fromCodePoint(Number.parseInt(octal[1], 8)), end: index + 1 + octal[0].length };
  return { value: character ?? "", end: Math.min(index + 2, source.length) };
}

function sqlStringToken(source, start) {
  const dollar = source.slice(start).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
  if (dollar) {
    const delimiter = dollar[0];
    const contentStart = start + delimiter.length;
    const closing = source.indexOf(delimiter, contentStart);
    if (closing === -1) fail("CANONICAL_NEON_INVALID_SQL_STRING", "unterminated dollar-quoted string");
    const end = closing + delimiter.length;
    return { type: "string", kind: "dollar", value: source.slice(contentStart, closing), raw: source.slice(start, end), start, end };
  }

  let kind = "ordinary";
  let quote = start;
  if (/^[eE]'/.test(source.slice(start))) {
    kind = "escape";
    quote += 1;
  } else if (/^[uU]&'/.test(source.slice(start))) {
    kind = "unicode";
    quote += 2;
  } else if (source[start] !== "'") return null;

  let value = "";
  let index = quote + 1;
  while (index < source.length) {
    if (source[index] === "'" && source[index + 1] === "'") {
      value += "'";
      index += 2;
    } else if (source[index] === "'") {
      const end = index + 1;
      return { type: "string", kind, value, raw: source.slice(start, end), start, end };
    } else if (kind === "escape" && source[index] === "\\") {
      const escapedCharacter = escapeStringCharacter(source, index);
      value += escapedCharacter.value;
      index = escapedCharacter.end;
    } else if (kind === "unicode" && source[index] === "\\") {
      const encoded = source.slice(index + 1).match(/^(?:\+([0-9a-f]{6})|([0-9a-f]{4}))/i);
      if (encoded) {
        value += String.fromCodePoint(Number.parseInt(encoded[1] ?? encoded[2], 16));
        index += 1 + encoded[0].length;
      } else if (source[index + 1] === "\\") {
        value += "\\";
        index += 2;
      } else {
        value += source[index++];
      }
    } else value += source[index++];
  }
  fail("CANONICAL_NEON_INVALID_SQL_STRING", "unterminated single-quoted string");
}

function tokenizeSql(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const string = sqlStringToken(source, index);
    if (string) {
      tokens.push(string);
      index = string.end;
      continue;
    }
    if (source[index] === '"') {
      const start = index++;
      let value = "";
      while (index < source.length) {
        if (source[index] === '"' && source[index + 1] === '"') {
          value += '"';
          index += 2;
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else value += source[index++];
      }
      if (source[index - 1] !== '"') fail("CANONICAL_NEON_INVALID_SQL_IDENTIFIER", "unterminated quoted identifier");
      tokens.push({ type: "identifier", value: value.toLowerCase(), raw: source.slice(start, index), start, end: index });
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/);
    if (identifier) {
      const start = index;
      index += identifier[0].length;
      tokens.push({ type: "identifier", value: identifier[0].toLowerCase(), raw: identifier[0], start, end: index });
      continue;
    }
    tokens.push({ type: "symbol", value: source[index], raw: source[index], start: index, end: index + 1 });
    index += 1;
  }
  return tokens;
}

function inspectSqlScopes(source, interestingDollarContent, inspect) {
  const executableSource = stripSqlComments(source);
  const tokens = tokenizeSql(executableSource);
  inspect(executableSource, tokens);
  for (const token of tokens) {
    if (token.type === "string" && token.kind === "dollar" && interestingDollarContent.test(token.value)) {
      inspectSqlScopes(token.value, interestingDollarContent, inspect);
    }
  }
}

function parsedCall(tokens, functionIndex) {
  if (tokens[functionIndex + 1]?.value !== "(") return null;
  const argumentsList = [[]];
  let depth = 0;
  for (let index = functionIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "(") {
      depth += 1;
      if (depth > 1) argumentsList.at(-1).push(token);
    } else if (token.value === ")") {
      depth -= 1;
      if (depth === 0) return { argumentsList, end: token.end };
      argumentsList.at(-1).push(token);
    } else if (token.value === "," && depth === 1) argumentsList.push([]);
    else if (depth >= 1) argumentsList.at(-1).push(token);
  }
  return null;
}

function functionBlocks(source) {
  const starts = [...source.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\b/gi)].map((match) => match.index);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

function runtimeRoleSourceChecks(source, manifest) {
  const runtimeRole = manifest.security?.runtimeRole;
  if (!runtimeRole) return;
  const rolePattern = new RegExp(`\\b(?:create|alter)\\s+role\\s+${escaped(runtimeRole)}\\b[^;]*;`, "gi");
  const statements = source.match(rolePattern) ?? [];
  const createStatement = statements.find((statement) => /\bcreate\s+role\b/i.test(statement));
  if (!createStatement || !/\bnoinherit\b/i.test(createStatement)) {
    fail("CANONICAL_NEON_RUNTIME_ROLE_NOINHERIT", `${runtimeRole} must be created NOINHERIT`);
  }
  if (!/\bnobypassrls\b/i.test(createStatement) || statements.some((statement) => /\bbypassrls\b/i.test(statement))) {
    fail("CANONICAL_NEON_RUNTIME_ROLE_BYPASSRLS", `${runtimeRole} must remain NOBYPASSRLS`);
  }
  if (statements.some((statement) => /\binherit\b/i.test(statement))) {
    fail("CANONICAL_NEON_RUNTIME_ROLE_INHERIT", `${runtimeRole} must remain NOINHERIT`);
  }
  if (statements.some((statement) => /\b(?:superuser|createdb|createrole|replication)\b/i.test(statement))) {
    fail("CANONICAL_NEON_RUNTIME_ROLE_ADMIN", `${runtimeRole} cannot receive administrative role attributes`);
  }
  if (new RegExp(`\\b(?:create|alter)\\s+(?:table|view|sequence|function|schema|type)\\s+[^;]*(?:\\bowner\\s+to|\\bauthorization)\\s+${escaped(runtimeRole)}\\b`, "i").test(source)) {
    fail("CANONICAL_NEON_APPLICATION_OWNERSHIP", `${runtimeRole} cannot own business objects`);
  }
  if (new RegExp(`\\breassign\\s+owned\\s+by\\s+[^;]+\\bto\\s+${escaped(runtimeRole)}\\b`, "i").test(source)) {
    fail("CANONICAL_NEON_APPLICATION_OWNERSHIP", `${runtimeRole} cannot receive reassigned object ownership`);
  }
}

function requireActorContextLocality(source) {
  const actorSettings = ["app.actor_auth_user_id", "app.actor_property_id", "app.actor_request_id"];
  const counts = new Map(actorSettings.map((setting) => [setting, 0]));
  inspectSqlScopes(source, /\bset_config\b/i, (_scope, tokens) => {
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index].type !== "identifier" || tokens[index].value !== "set_config") continue;
      const call = parsedCall(tokens, index);
      const firstArgument = call?.argumentsList[0] ?? [];
      const staticTarget = firstArgument.length === 1 && firstArgument[0].type === "string"
        ? firstArgument[0].value.toLowerCase()
        : null;
      if (!staticTarget) {
        fail("CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL", "set_config targets must be static approved actor GUC string literals");
      }
      if (!counts.has(staticTarget)) fail("CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL", `unapproved actor GUC set_config target: ${staticTarget}`);
      const locality = call.argumentsList[2] ?? [];
      if (call.argumentsList.length !== 3 || locality.length !== 1 || locality[0].type !== "identifier" || locality[0].value !== "true") {
        fail("CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL", `${staticTarget} must use set_config(..., true)`);
      }
      counts.set(staticTarget, counts.get(staticTarget) + 1);
    }
  });
  for (const setting of actorSettings) {
    if (counts.get(setting) === 0) fail("CANONICAL_NEON_ACTOR_CONTEXT_NOT_LOCAL", `${setting} must use set_config(..., true)`);
  }
}

function requireNoRawRuntimeGrants(source, runtimeRole) {
  if (!runtimeRole) return;
  const normalizedRuntimeRole = normalizeIdentifier(runtimeRole);
  const tablePrivileges = new Set(["all", "select", "insert", "update", "delete", "truncate", "references", "trigger"]);
  const rawObjectKinds = new Set(["table", "schema", "sequence"]);
  inspectSqlScopes(source, /\bgrant\b/i, (_scope, tokens) => {
    for (let start = 0; start < tokens.length; start += 1) {
      if (tokens[start].type !== "identifier" || tokens[start].value !== "grant") continue;
      let end = start + 1;
      while (end < tokens.length && tokens[end].value !== ";") end += 1;
      const statement = tokens.slice(start, end);
      const on = statement.findIndex((token) => token.type === "identifier" && token.value === "on");
      const to = statement.findIndex((token, index) => index > on && token.type === "identifier" && token.value === "to");
      if (on === -1 || to === -1) continue;

      const objectTokens = statement.slice(on + 1, to).filter((token) => token.type === "identifier");
      const explicitKind = objectTokens[0]?.value;
      const allKind = explicitKind === "all" ? objectTokens[1]?.value : null;
      const isRawObjectGrant = rawObjectKinds.has(explicitKind)
        || allKind === "tables"
        || allKind === "sequences"
        || statement.slice(1, on).some((token) => token.type === "identifier" && tablePrivileges.has(token.value));
      if (!isRawObjectGrant) continue;

      let granteeEnd = statement.length;
      const withClause = statement.findIndex((token, index) => index > to && token.type === "identifier" && ["with", "granted"].includes(token.value));
      if (withClause !== -1) granteeEnd = withClause;
      const granteeTokens = statement.slice(to + 1, granteeEnd);
      const hasUnicodeQuotedGrantee = granteeTokens.some((token, index) => token.type === "identifier" && token.value === "u"
        && granteeTokens[index + 1]?.value === "&"
        && granteeTokens[index + 2]?.type === "identifier"
        && granteeTokens[index + 2].raw.startsWith('"'));
      if (hasUnicodeQuotedGrantee) {
        fail("CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE", "Unicode quoted grantees are forbidden in raw object grants");
      }
      const grantees = granteeTokens
        .filter((token) => token.type === "identifier" && token.value !== "group")
        .map((token) => token.value);
      if (grantees.includes(normalizedRuntimeRole)) {
        fail("CANONICAL_NEON_APPLICATION_RAW_TABLE_PRIVILEGE", `${runtimeRole} cannot receive raw table, schema, or sequence privileges`);
      }
    }
  });
}

function requirePublicRevocations(source, routines) {
  const defaultPrivilege = source.match(/\balter\s+default\s+privileges\s+for\s+role\s+hotel_ld_migration_owner\s+revoke\s+execute\s+on\s+functions\s+from\s+public\s*;/i);
  const firstFunction = source.search(/\bcreate\s+(?:or\s+replace\s+)?function\b/i);
  if (defaultPrivilege && (firstFunction === -1 || defaultPrivilege.index < firstFunction)) return;
  for (const routine of routines) {
    const pattern = new RegExp(`\\brevoke\\s+(?:all|execute)\\s+on\\s+function\\s+${escaped(routine)}\\s*\\([\\s\\S]*?\\)\\s+from\\s+public\\s*;`, "i");
    if (!pattern.test(source)) fail("CANONICAL_NEON_PUBLIC_EXECUTE_DEFAULT", `missing explicit PUBLIC EXECUTE revocation for ${routine}`);
  }
}

function grantedEntrypoints(source, runtimeRole) {
  const grants = [...source.matchAll(new RegExp(`\\bgrant\\s+execute\\s+on\\s+function\\s+([\\s\\S]*?)\\s+to\\s+${escaped(runtimeRole)}\\s*;`, "gi"))];
  return orderedUnique(grants.flatMap((grant) => [...grant[1].matchAll(new RegExp(`(public\\.${IDENTIFIER})\\s*\\(`, "gi"))].map((match) => normalizeIdentifier(match[1]))));
}

function grantedEntrypointSignatures(source, runtimeRole) {
  const grants = [...source.matchAll(new RegExp(`\\bgrant\\s+execute\\s+on\\s+function\\s+([\\s\\S]*?)\\s+to\\s+${escaped(runtimeRole)}\\s*;`, "gi"))];
  return orderedUnique(grants.flatMap((grant) => [...grant[1].matchAll(new RegExp(`(public\\.${IDENTIFIER})\\s*\\(([^()]*)\\)`, "gi"))]
    .map((match) => `${normalizeIdentifier(match[1])}(${match[2].replace(/\\s+/g, "").toLowerCase()})`)));
}

function createdEntrypointSignatures(source) {
  const definitions = [...source.matchAll(new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+(public\\.${IDENTIFIER})\\s*\\(([^()]*)\\)`, "gi"))];
  return orderedUnique(definitions.map((definition) => {
    const types = definition[2].split(",").map((argument) => {
      const withoutDefault = argument.trim().replace(/\s+default\s+.+$/i, "");
      const tokens = withoutDefault.replace(/^(?:in|out|inout|variadic)\s+/i, "").trim().split(/\s+/);
      return tokens.length === 1 ? tokens[0] : tokens.at(-1);
    });
    return `${normalizeIdentifier(definition[1])}(${types.join(",").replace(/\s+/g, "").toLowerCase()})`;
  }));
}

function rejectUnsafeSource(source, manifest) {
  const exclusions = [
    ...manifest.exclusions.schemas,
    ...manifest.exclusions.objects,
  ].map((value) => String(value).toLowerCase());
  const forbiddenSchema = /\b(?:create|alter|grant\s+usage\s+on)\s+schema\s+(?:if\s+not\s+exists\s+)?(?:auth|storage|extensions|supabase_functions)\b|\b(?:auth|storage)\s*\./i;
  if (/\bauth\s*\.\s*(?:uid|users)\b/i.test(source)) fail("CANONICAL_NEON_FORBIDDEN_TOKEN", "canonical baseline cannot use auth.uid() or auth.users");
  if (forbiddenSchema.test(source)) fail("CANONICAL_NEON_FORBIDDEN_SCHEMA", "canonical baseline cannot contain a Supabase schema or reference");
  if (/(?:\bcreate\s+(?:table|view|function|type|role)|\bcreate\s+(?:constraint\s+)?trigger|\bcreate\s+policy)\s+[^;\n]*(?:import|provenance|history|audit|compatibility|bridge|reset|test_user|test_data)[a-z0-9_]*/i.test(source)) {
    fail("CANONICAL_NEON_FORBIDDEN_OBJECT", "canonical baseline contains an explicitly excluded object");
  }
  if (/\bgrant\s+(?:execute|all(?:\s+privileges)?)\s+on\s+(?:function|all\s+functions)[^;]*\bto\s+public\b/i.test(source)) {
    fail("CANONICAL_NEON_PUBLIC_EXECUTE", "PUBLIC EXECUTE is forbidden");
  }
  if (/(?:\bcreate|\balter)\s+role\s+(?:authenticated|anon|service_role|postgres|supabase_admin|dashboard_user)\b|\bgrant\b[^;]*\bto\s+(?:authenticated|anon|service_role)\b/i.test(source)) {
    fail("CANONICAL_NEON_BROAD_COMPATIBILITY_ROLE", "canonical baseline cannot create or grant to broad compatibility roles");
  }
  if (/(?:^|;)\s*set\s+(?!local\b)/i.test(source)) fail("CANONICAL_NEON_PERSISTENT_SET", "persistent session SET is forbidden; Actor Context must be transaction-local");
  requireNoRawRuntimeGrants(source, manifest.security?.runtimeRole);
  const topLevel = stripDollarQuotedBlocks(source);
  const businessTables = asStringArray(manifest, "tables").map((table) => escaped(table.split(".").at(-1))).join("|");
  if (new RegExp(`\\b(?:insert\\s+into|update|delete\\s+from)\\s+(?:only\\s+)?(?:public\\.)?(?:${businessTables})\\b`, "i").test(topLevel)) {
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
  const source = normalizeQuotedIdentifiers(stripSqlComments(sources.join("\n")));
  rejectUnsafeSource(source, manifest);
  const actual = objectInventory(source);
  const declaredSchemas = asStringArray(manifest, "schemas");
  compareInventory("schemas", actual.schemas, declaredSchemas.filter((schema) => schema !== "public"));
  for (const kind of ["roles", "types", "tables", "routines", "policies", "triggers"]) {
    compareInventory(kind, actual[kind], asStringArray(manifest, kind));
  }
  const routines = asStringArray(manifest, "routines");
  const entrypoints = asStringArray(manifest, "entrypoints");
  const entrypointSignatures = asStringArray(manifest, "entrypointSignatures").map((signature) => signature.replace(/\s+/g, ""));
  if (entrypoints.some((entrypoint) => !routines.includes(entrypoint))) {
    fail("CANONICAL_NEON_MANIFEST_ENTRYPOINT_DRIFT", "every declared entrypoint must also be a declared routine");
  }
  if (entrypointSignatures.map((signature) => signature.slice(0, signature.indexOf("("))).some((entrypoint) => !entrypoints.includes(entrypoint))) {
    fail("CANONICAL_NEON_MANIFEST_ENTRYPOINT_DRIFT", "every declared entrypoint signature must name a declared entrypoint");
  }
  compareInventory("entrypoints", grantedEntrypoints(source, manifest.security?.runtimeRole), entrypoints);
  try {
    compareInventory("entrypoint signatures", grantedEntrypointSignatures(source, manifest.security?.runtimeRole), entrypointSignatures);
    compareInventory("created entrypoint signatures", createdEntrypointSignatures(source).filter((signature) => entrypoints.includes(signature.slice(0, signature.indexOf("(")))), entrypointSignatures);
  } catch (error) {
    if (error?.code === "CANONICAL_NEON_MANIFEST_DRIFT") fail("CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT", error.message);
    throw error;
  }
  runtimeRoleSourceChecks(source, manifest);
  requireActorContextLocality(source);
  requirePublicRevocations(source, routines);
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
