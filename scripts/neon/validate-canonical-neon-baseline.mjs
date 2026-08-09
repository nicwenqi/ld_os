#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const VALID_MODES = new Set(["source", "dry-run", "apply", "catalog", "runtime", "repeatability"]);
const DATABASE_MODES = new Set(["dry-run", "apply", "catalog", "runtime", "repeatability"]);
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../neon/canonical");
const IDENTIFIER = "[a-z_][a-z0-9_]*";

export const EXPECTED_NEON_TARGET = Object.freeze({
  projectName: "hotel-ld-os-neon-final-staging",
  projectId: "jolly-dawn-48919555",
  branchName: "main",
  branchId: "br-empty-star-axdyyv60",
  endpointId: "ep-winter-resonance-ax340i3r",
  database: "neondb",
  bootstrapRole: "neondb_owner",
  postgresMajor: 18,
});

export const REPLAY_NEON_TARGET = Object.freeze({
  projectName: "hotel-ld-os-neon-final-replay",
  projectId: "wild-tree-31942896",
  branchName: "main",
  branchId: "br-frosty-forest-awu4aprl",
  endpointId: "ep-hidden-meadow-aweq2rfx",
  database: "neondb",
  bootstrapRole: "neondb_owner",
  postgresMajor: 18,
});

export const AUTHORIZED_NEON_TARGETS = Object.freeze([
  EXPECTED_NEON_TARGET,
  REPLAY_NEON_TARGET,
]);

const FORBIDDEN_NEON_TARGETS = new Set([
  "br-twilight-leaf-azmowo1k",
  "ep-wild-wave-azjmgdif",
  "br-aged-river-az1gke14",
  "ep-sparkling-shape-az9gxtuh",
  "billowing-wave-98815473",
  "br-little-sky-auwkzocd",
  "ep-wispy-star-auleq9jk",
  "flat-brook-43278549",
]);

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

function normalizePolicySourceExpression(value) {
  return tokenizeSql(String(value ?? "")).map((token) => {
    if (token.type === "identifier" && token.raw.startsWith('"')) return `quoted-identifier:${JSON.stringify(token.raw)}`;
    if (token.type === "identifier") return `identifier:${token.value}`;
    if (token.type === "string") return `string:${JSON.stringify(token.value)}`;
    return `symbol:${token.value}`;
  }).join(" ");
}

function policyDescriptorCore(descriptor) {
  const roles = orderedUnique(descriptor.roles.map(normalizeIdentifier));
  return [
    `${normalizeIdentifier(descriptor.schema)}.${normalizeIdentifier(descriptor.table)}:${normalizeIdentifier(descriptor.name)}`,
    normalizeIdentifier(descriptor.command),
    roles.join(","),
    descriptor.permissive ? "permissive" : "restrictive",
  ];
}

function policySourceDescriptorValue(descriptor) {
  return [
    ...policyDescriptorCore(descriptor),
    normalizePolicySourceExpression(descriptor.using),
    normalizePolicySourceExpression(descriptor.withCheck),
  ].join("|");
}

function policyCatalogDescriptorValue(descriptor) {
  if (descriptor.catalogUsing.includes("|") || descriptor.catalogWithCheck.includes("|")) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "catalog policy expressions cannot contain descriptor delimiters");
  }
  return [
    ...policyDescriptorCore(descriptor),
    descriptor.catalogUsing,
    descriptor.catalogWithCheck,
  ].join("|");
}

function triggerDescriptorValue(descriptor) {
  return [
    `${normalizeIdentifier(descriptor.schema)}.${normalizeIdentifier(descriptor.table)}:${normalizeIdentifier(descriptor.name)}`,
    normalizeIdentifier(descriptor.enabled),
    normalizeIdentifier(descriptor.timing),
    orderedUnique(descriptor.events.map(normalizeIdentifier)).join(","),
    normalizeIdentifier(descriptor.level),
    orderedUnique(descriptor.updateColumns.map(normalizeIdentifier)).join(","),
    normalizeIdentifier(descriptor.function).replace(/\s+/g, ""),
  ].join("|");
}

function securityDescriptorInventory(manifest, kind, representation = "source") {
  const key = kind === "policy" ? "policyDescriptors" : "triggerDescriptors";
  const descriptors = manifest.security?.[key];
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", `manifest.security.${key} must be a non-empty array`);
  }
  const expectedKeys = kind === "policy"
    ? ["catalogUsing", "catalogWithCheck", "command", "name", "permissive", "roles", "schema", "table", "using", "withCheck"]
    : ["enabled", "events", "function", "level", "name", "schema", "table", "timing", "updateColumns"];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
      || Object.keys(descriptor).sort().join("|") !== expectedKeys.sort().join("|")) {
      fail("CANONICAL_NEON_INVALID_MANIFEST", `manifest.security.${key} contains an incomplete descriptor`);
    }
    const arrayKeys = kind === "policy" ? ["roles"] : ["events", "updateColumns"];
    if (arrayKeys.some((name) => !Array.isArray(descriptor[name]) || descriptor[name].some((value) => typeof value !== "string"))) {
      fail("CANONICAL_NEON_INVALID_MANIFEST", `manifest.security.${key} descriptor arrays must contain strings`);
    }
    const scalarKeys = expectedKeys.filter((name) => !arrayKeys.includes(name) && name !== "permissive");
    if (scalarKeys.some((name) => typeof descriptor[name] !== "string")
      || (kind === "policy" && typeof descriptor.permissive !== "boolean")) {
      fail("CANONICAL_NEON_INVALID_MANIFEST", `manifest.security.${key} descriptor fields have invalid types`);
    }
  }
  if (kind === "trigger") return orderedUnique(descriptors.map(triggerDescriptorValue));
  return orderedUnique(descriptors.map(representation === "catalog" ? policyCatalogDescriptorValue : policySourceDescriptorValue));
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
  securityDescriptorInventory(manifest, "policy");
  securityDescriptorInventory(manifest, "trigger");
  const smokeRejections = manifest.security?.runtimeSmokeExpectedRejections;
  if (!smokeRejections || typeof smokeRejections !== "object" || Array.isArray(smokeRejections)) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "manifest.security.runtimeSmokeExpectedRejections must be an exact-signature map");
  }
  const signatures = new Set(asStringArray(manifest, "entrypointSignatures").map((signature) => signature.replace(/\s+/g, "")));
  for (const [signature, rejections] of Object.entries(smokeRejections)) {
    const normalized = normalizeIdentifier(signature).replace(/\s+/g, "");
    if (!signatures.has(normalized) || !Array.isArray(rejections) || rejections.length === 0
      || rejections.some((rejection) => !rejection || typeof rejection !== "object" || Array.isArray(rejection)
        || Object.keys(rejection).sort().join("|") !== "code|message"
        || typeof rejection.code !== "string" || typeof rejection.message !== "string")) {
      fail("CANONICAL_NEON_INVALID_MANIFEST", "runtime smoke rejections require declared exact signatures and exact code/message pairs");
    }
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

function parenthesizedSqlClause(statement, words) {
  const tokens = tokenizeSql(statement);
  for (let index = 0; index <= tokens.length - words.length; index += 1) {
    if (!words.every((word, offset) => tokens[index + offset]?.value === word)) continue;
    const openingIndex = index + words.length;
    if (tokens[openingIndex]?.value !== "(") continue;
    let depth = 0;
    for (let cursor = openingIndex; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === "(") depth += 1;
      if (tokens[cursor].value === ")") depth -= 1;
      if (depth === 0) {
        return statement.slice(tokens[openingIndex].end, tokens[cursor].start);
      }
    }
  }
  return "";
}

export function canonicalPolicyDescriptors(source) {
  return orderedUnique([...source.matchAll(/\bcreate\s+policy\b[\s\S]*?;/gi)].map(({ 0: statement }) => {
    const header = statement.slice(0, [statement.search(/\busing\s*\(/i), statement.search(/\bwith\s+check\s*\(/i), statement.length]
      .filter((index) => index >= 0).sort((left, right) => left - right)[0]).replace(/\s+/g, " ").trim();
    const match = header.match(/^create\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)(?:\s+as\s+(permissive|restrictive))?(?:\s+for\s+(all|select|insert|update|delete))?(?:\s+to\s+(.+?))?$/i);
    if (!match) fail("CANONICAL_NEON_POLICY_DESCRIPTOR_DRIFT", "cannot parse canonical policy descriptor");
    const roles = (match[6] ?? "public").split(",").map((role) => role.trim()).filter(Boolean);
    return policySourceDescriptorValue({
      schema: match[2], table: match[3], name: match[1], command: match[5] ?? "all",
      roles, permissive: (match[4] ?? "permissive").toLowerCase() === "permissive",
      using: parenthesizedSqlClause(statement, ["using"]),
      withCheck: parenthesizedSqlClause(statement, ["with", "check"]),
    });
  }));
}

export function canonicalTriggerDescriptors(source) {
  return orderedUnique([...source.matchAll(/\bcreate\s+(?:constraint\s+)?trigger\b[\s\S]*?;/gi)].map(({ 0: statement }) => {
    const normalized = statement.replace(/\s+/g, " ").trim();
    const match = normalized.match(/^create\s+(?:constraint\s+)?trigger\s+([a-z_][a-z0-9_]*)\s+(before|after|instead\s+of)\s+(.+?)\s+on\s+([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+for\s+each\s+(row|statement)\s+execute\s+function\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(([^)]*)\)\s*;$/i);
    if (!match) fail("CANONICAL_NEON_TRIGGER_DESCRIPTOR_DRIFT", "cannot parse canonical trigger descriptor");
    const eventClause = match[3].toLowerCase();
    const events = [...eventClause.matchAll(/(?:^|\bor\s+)(insert|update|delete|truncate)\b/g)].map((event) => event[1]);
    const updateColumns = eventClause.match(/\bupdate\s+of\s+(.+?)(?:\s+or\s+(?:insert|delete|truncate)\b|$)/)?.[1]
      ?.split(",").map((column) => column.trim()).filter(Boolean) ?? [];
    return triggerDescriptorValue({
      schema: match[4], table: match[5], name: match[1], enabled: "origin", timing: match[2],
      events, level: match[6], updateColumns, function: `${match[7]}(${match[8].replace(/\s+/g, "")})`,
    });
  }));
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
  if (/(?:\bcreate\s+(?:table|view|function|type|role)|\bcreate\s+(?:constraint\s+)?trigger|\bcreate\s+policy)\s+[^;\n]*(?:import|provenance|history|compatibility|bridge|reset|test_user|test_data)[a-z0-9_]*/i.test(source)) {
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
  const descriptorSource = stripSqlComments(sources.join("\n"));
  const source = normalizeQuotedIdentifiers(descriptorSource);
  rejectUnsafeSource(source, manifest);
  const actual = objectInventory(source);
  const declaredSchemas = asStringArray(manifest, "schemas");
  compareInventory("schemas", actual.schemas, declaredSchemas.filter((schema) => schema !== "public"));
  for (const kind of ["roles", "types", "tables", "routines", "policies", "triggers"]) {
    compareInventory(kind, actual[kind], asStringArray(manifest, kind));
  }
  try {
    compareInventory("policy descriptors", canonicalPolicyDescriptors(descriptorSource), securityDescriptorInventory(manifest, "policy", "source"));
  } catch (error) {
    if (error?.code === "CANONICAL_NEON_MANIFEST_DRIFT") fail("CANONICAL_NEON_POLICY_DESCRIPTOR_DRIFT", error.message);
    throw error;
  }
  try {
    compareInventory("trigger descriptors", canonicalTriggerDescriptors(source), securityDescriptorInventory(manifest, "trigger"));
  } catch (error) {
    if (error?.code === "CANONICAL_NEON_MANIFEST_DRIFT") fail("CANONICAL_NEON_TRIGGER_DESCRIPTOR_DRIFT", error.message);
    throw error;
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

function assertExpectedTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    fail("CANONICAL_NEON_TARGET_REQUIRED", "exact canonical Neon target metadata is required");
  }
  if (Object.values(target).some((value) => FORBIDDEN_NEON_TARGETS.has(String(value)))) {
    fail("CANONICAL_NEON_TARGET_MISMATCH", "forbidden Neon target metadata");
  }
  const targetKeys = Object.keys(target).sort();
  const matched = AUTHORIZED_NEON_TARGETS.find((candidate) => {
    const candidateKeys = Object.keys(candidate).sort();
    return targetKeys.length === candidateKeys.length
      && targetKeys.every((key, index) => key === candidateKeys[index])
      && candidateKeys.every((key) => target[key] === candidate[key]);
  });
  if (!matched) {
    fail("CANONICAL_NEON_TARGET_MISMATCH", "canonical Neon target metadata does not match a complete authorized tuple");
  }
  return matched;
}

function parseConnectionTarget(connectionString, kind, target) {
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    fail(`CANONICAL_NEON_${kind.toUpperCase()}_CONNECTION_MISMATCH`, `${kind} connection is not a PostgreSQL URL`);
  }
  const code = `CANONICAL_NEON_${kind.toUpperCase()}_CONNECTION_MISMATCH`;
  const endpointLabel = kind === "runtime"
    ? `${target.endpointId}-pooler`
    : target.endpointId;
  const expectedRole = kind === "runtime" ? "hotel_ld_application" : target.bootstrapRole;
  const decodedDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const unsafeSsl = new Set(["disable", "prefer", "allow", "no-verify"]);
  if (
    !/^postgres(?:ql)?:$/.test(parsed.protocol)
    || !parsed.hostname.endsWith(".neon.tech")
    || parsed.hostname.split(".")[0] !== endpointLabel
    || decodeURIComponent(parsed.username) !== expectedRole
    || !decodeURIComponent(parsed.password)
    || decodedDatabase !== target.database
    || unsafeSsl.has(parsed.searchParams.get("sslmode") ?? "")
    || [...FORBIDDEN_NEON_TARGETS].some((id) => parsed.hostname.includes(id))
  ) {
    fail(code, `${kind} connection does not match the authorized canonical Neon target`);
  }
  return { kind, endpointId: target.endpointId, database: decodedDatabase, role: expectedRole };
}

function stripModuleTransactionFrame(source, path) {
  const framed = source.match(/^\s*begin\s*;([\s\S]*?)commit\s*;\s*$/i);
  if (!framed) {
    fail("CANONICAL_NEON_MODULE_TRANSACTION_FRAME", `${path} must have exactly one validated leading BEGIN and trailing COMMIT frame`);
  }
  return framed[1].trim();
}

async function loadDatabaseBundle(root) {
  const canonicalRoot = resolve(root);
  const manifest = await loadManifest(canonicalRoot);
  const modules = validateManifest(manifest);
  const sources = await Promise.all(modules.map(async ({ path }) => ({
    path,
    source: stripModuleTransactionFrame(await readFile(join(canonicalRoot, path), "utf8"), path),
  })));
  return { manifest, modules: sources };
}

const TARGET_IDENTITY_SQL = `
  /* canonical_target_identity */
  select
    pg_catalog.current_setting('server_version_num')::integer as server_version_num,
    current_database() as database_name,
    database_owner.rolname as database_owner,
    current_user as current_role,
    session_user as session_role
  from pg_catalog.pg_database as database_record
  join pg_catalog.pg_roles as database_owner on database_owner.oid = database_record.datdba
  where database_record.datname = current_database()
`;

const EMPTY_STATE_SQL = `
  /* canonical_empty_state */
  select
    (select count(*)::integer from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname in ('public','app_private')
        and relation.relkind in ('r','p'))
    + (select count(*)::integer from pg_catalog.pg_proc as routine
          join pg_catalog.pg_namespace as namespace on namespace.oid = routine.pronamespace
          where namespace.nspname = 'app_private')
      + (select count(*)::integer from pg_catalog.pg_type as data_type
          join pg_catalog.pg_namespace as namespace on namespace.oid = data_type.typnamespace
          where namespace.nspname in ('public','app_private') and data_type.typtype = 'e')
      + (select count(*)::integer from pg_catalog.pg_namespace where nspname='app_private')
      as application_object_count,
    (select count(*)::integer from pg_catalog.pg_roles
      where rolname in ('hotel_ld_application','hotel_ld_migration_owner')) as canonical_role_count,
    (select count(*)::integer from pg_catalog.pg_namespace
      where nspname in ('auth','storage')) as forbidden_schema_count,
    0::integer as application_row_count,
    (select count(*)::integer from pg_catalog.pg_proc as routine
      join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
      where namespace.nspname='public') as provider_routine_count
`;

function expectedCatalogCounts(manifest, modules) {
  const source = modules.map(({ source }) => source).join("\n");
  return {
    schema_count: asStringArray(manifest, "schemas").length,
    type_count: asStringArray(manifest, "types").length,
    table_count: asStringArray(manifest, "tables").length,
    routine_count: asStringArray(manifest, "routines").length,
    entrypoint_count: asStringArray(manifest, "entrypoints").length,
    policy_count: [...source.matchAll(/\bcreate\s+policy\b/gi)].length,
    trigger_count: asStringArray(manifest, "triggers").length,
    rls_table_count: asStringArray(manifest, "tables").length,
    application_row_count: 0,
    audit_row_count: 0,
  };
}

const CATALOG_BOOLEAN_FIELDS = [
  "roles_exact",
  "runtime_role_restricted",
  "migration_role_restricted",
  "runtime_memberships_empty",
  "runtime_owns_nothing",
  "migration_owner_owns_all",
  "schemas_exact",
  "types_exact",
  "tables_exact",
  "routines_exact",
  "entrypoints_exact",
  "policies_exact",
  "triggers_exact",
  "rls_exact",
  "runtime_raw_privileges_empty",
  "runtime_private_schema_denied",
  "runtime_entrypoints_exact",
  "definers_hardened",
  "audit_append_only",
  "exclusions_absent",
  "rows_empty",
];

export const POLICY_CATALOG_DESCRIPTOR_SQL = `
  /* canonical_policy_catalog_descriptors */
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema',namespace.nspname,
    'table',relation.relname,
    'name',policy.polname,
    'command',case policy.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end,
    'roles',coalesce((select pg_catalog.jsonb_agg(coalesce(role_record.rolname,'public') order by coalesce(role_record.rolname,'public'))
      from pg_catalog.unnest(policy.polroles) as policy_role(role_oid)
      left join pg_catalog.pg_roles as role_record on role_record.oid=policy_role.role_oid),'[]'::jsonb),
    'permissive',policy.polpermissive,
    'catalogUsing',coalesce(pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),''),
    'catalogWithCheck',coalesce(pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid),'')
  ) order by namespace.nspname,relation.relname,policy.polname),'[]'::jsonb) as descriptors
  from pg_catalog.pg_policy as policy
  join pg_catalog.pg_class as relation on relation.oid=policy.polrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
  where namespace.nspname in ('public','app_private')
`;

const CATALOG_MATRIX_SQL = `
  /* canonical_catalog_matrix */
  with expected as (
    select $1::text[] as schemas, $2::text[] as types, $3::text[] as tables,
           $4::text[] as routines, $5::text[] as entrypoints,
           $6::text[] as policies, $7::text[] as triggers, $8::text[] as audit_tables
  ), actual as (
    select
      coalesce((select pg_catalog.array_agg(namespace.nspname::text order by namespace.nspname)
        from pg_catalog.pg_namespace as namespace
        where namespace.nspname !~ '^pg_' and namespace.nspname <> 'information_schema'), '{}'::text[]) as schemas,
      coalesce((select pg_catalog.array_agg(namespace.nspname||'.'||data_type.typname order by namespace.nspname,data_type.typname)
        from pg_catalog.pg_type as data_type join pg_catalog.pg_namespace as namespace on namespace.oid=data_type.typnamespace
        where namespace.nspname in ('public','app_private') and data_type.typtype='e'), '{}'::text[]) as types,
      coalesce((select pg_catalog.array_agg(namespace.nspname||'.'||relation.relname order by namespace.nspname,relation.relname)
        from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
        where namespace.nspname in ('public','app_private') and relation.relkind in ('r','p')), '{}'::text[]) as tables,
      coalesce((select pg_catalog.array_agg(namespace.nspname||'.'||routine.proname order by namespace.nspname,routine.proname)
        from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
        where namespace.nspname in ('public','app_private')), '{}'::text[]) as routines,
      coalesce((select pg_catalog.array_agg(
          namespace.nspname||'.'||routine.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(routine.proargtypes),' ','')||')'
          order by namespace.nspname,routine.proname,pg_catalog.oidvectortypes(routine.proargtypes))
        from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
        where namespace.nspname='public'), '{}'::text[]) as entrypoints,
      coalesce((select pg_catalog.array_agg(
          namespace.nspname||'.'||relation.relname||':'||policy.polname||'|'||
          case policy.polcmd when 'r' then 'select' when 'a' then 'insert' when 'w' then 'update' when 'd' then 'delete' else 'all' end||'|'||
          coalesce((select pg_catalog.string_agg(coalesce(role_record.rolname,'public'),',' order by coalesce(role_record.rolname,'public'))
            from pg_catalog.unnest(policy.polroles) as policy_role(role_oid)
            left join pg_catalog.pg_roles as role_record on role_record.oid=policy_role.role_oid),'')||'|'||
          case when policy.polpermissive then 'permissive' else 'restrictive' end||'|'||
          coalesce(pg_catalog.pg_get_expr(policy.polqual,policy.polrelid),'')||'|'||
          coalesce(pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid),'')
          order by namespace.nspname,relation.relname,policy.polname)
        from pg_catalog.pg_policy as policy join pg_catalog.pg_class as relation on relation.oid=policy.polrelid
        join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
        where namespace.nspname in ('public','app_private')), '{}'::text[]) as policies,
      coalesce((select pg_catalog.array_agg(
          namespace.nspname||'.'||relation.relname||':'||trigger.tgname||'|'||
          case trigger.tgenabled when 'O' then 'origin' when 'D' then 'disabled' when 'R' then 'replica' else 'always' end||'|'||
          case when (trigger.tgtype & 64)=64 then 'instead of' when (trigger.tgtype & 2)=2 then 'before' else 'after' end||'|'||
          pg_catalog.array_to_string(pg_catalog.array_remove(array[
            case when (trigger.tgtype & 8)=8 then 'delete' end,
            case when (trigger.tgtype & 4)=4 then 'insert' end,
            case when (trigger.tgtype & 32)=32 then 'truncate' end,
            case when (trigger.tgtype & 16)=16 then 'update' end
          ],null),',')||'|'||
          case when (trigger.tgtype & 1)=1 then 'row' else 'statement' end||'|'||
          coalesce((select pg_catalog.string_agg(attribute.attname,',' order by attribute.attname)
            from pg_catalog.unnest(trigger.tgattr::smallint[]) as trigger_attribute(attnum)
            join pg_catalog.pg_attribute as attribute on attribute.attrelid=trigger.tgrelid and attribute.attnum=trigger_attribute.attnum),'')||'|'||
          routine_namespace.nspname||'.'||routine.proname||'('||pg_catalog.replace(pg_catalog.pg_get_function_identity_arguments(routine.oid),' ','')||')'
          order by namespace.nspname,relation.relname,trigger.tgname)
        from pg_catalog.pg_trigger as trigger join pg_catalog.pg_class as relation on relation.oid=trigger.tgrelid
        join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
        join pg_catalog.pg_proc as routine on routine.oid=trigger.tgfoid
        join pg_catalog.pg_namespace as routine_namespace on routine_namespace.oid=routine.pronamespace
        where namespace.nspname in ('public','app_private') and not trigger.tgisinternal), '{}'::text[]) as triggers
  )
  select
    pg_catalog.cardinality(actual.schemas)::integer as schema_count,
    pg_catalog.cardinality(actual.types)::integer as type_count,
    pg_catalog.cardinality(actual.tables)::integer as table_count,
    pg_catalog.cardinality(actual.routines)::integer as routine_count,
    pg_catalog.cardinality(actual.entrypoints)::integer as entrypoint_count,
    pg_catalog.cardinality(actual.policies)::integer as policy_count,
    pg_catalog.cardinality(actual.triggers)::integer as trigger_count,
    (select count(*)::integer from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
      where namespace.nspname in ('public','app_private') and relation.relkind in ('r','p')
        and relation.relrowsecurity and relation.relforcerowsecurity) as rls_table_count,
    0::integer as application_row_count,
    0::integer as audit_row_count,
    ((select count(*) from pg_catalog.pg_roles where rolname in ('hotel_ld_application','hotel_ld_migration_owner'))=2) as roles_exact,
    coalesce((select role_record.rolcanlogin and not role_record.rolinherit and not role_record.rolsuper
      and not role_record.rolbypassrls and not role_record.rolcreatedb and not role_record.rolcreaterole
      and not role_record.rolreplication from pg_catalog.pg_roles as role_record where role_record.rolname='hotel_ld_application'),false)
      as runtime_role_restricted,
    coalesce((select not role_record.rolcanlogin and not role_record.rolinherit and not role_record.rolsuper
      and not role_record.rolbypassrls and not role_record.rolcreatedb and not role_record.rolcreaterole
      and not role_record.rolreplication from pg_catalog.pg_roles as role_record where role_record.rolname='hotel_ld_migration_owner'),false)
      as migration_role_restricted,
    not exists(select 1 from pg_catalog.pg_auth_members as membership join pg_catalog.pg_roles as member_role on member_role.oid=membership.member
      where member_role.rolname='hotel_ld_application') as runtime_memberships_empty,
    not exists(
      select 1 from pg_catalog.pg_database as database_record join pg_catalog.pg_roles as owner_role on owner_role.oid=database_record.datdba where owner_role.rolname='hotel_ld_application'
      union all select 1 from pg_catalog.pg_namespace as namespace join pg_catalog.pg_roles as owner_role on owner_role.oid=namespace.nspowner where owner_role.rolname='hotel_ld_application'
      union all select 1 from pg_catalog.pg_class as relation join pg_catalog.pg_roles as owner_role on owner_role.oid=relation.relowner where owner_role.rolname='hotel_ld_application'
      union all select 1 from pg_catalog.pg_type as data_type join pg_catalog.pg_roles as owner_role on owner_role.oid=data_type.typowner where owner_role.rolname='hotel_ld_application'
      union all select 1 from pg_catalog.pg_proc as routine join pg_catalog.pg_roles as owner_role on owner_role.oid=routine.proowner where owner_role.rolname='hotel_ld_application'
    ) as runtime_owns_nothing,
    not exists(
      select 1 from pg_catalog.unnest(expected.schemas) as item(value)
        left join pg_catalog.pg_namespace as namespace on namespace.nspname=item.value
        left join pg_catalog.pg_roles as owner_role on owner_role.oid=namespace.nspowner
        where owner_role.rolname is distinct from 'hotel_ld_migration_owner'
      union all select 1 from pg_catalog.unnest(expected.tables) as item(value)
        left join pg_catalog.pg_class as relation on relation.oid=pg_catalog.to_regclass(item.value)
        left join pg_catalog.pg_roles as owner_role on owner_role.oid=relation.relowner
        where owner_role.rolname is distinct from 'hotel_ld_migration_owner'
      union all select 1 from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
        join pg_catalog.pg_roles as owner_role on owner_role.oid=routine.proowner
        where namespace.nspname in ('public','app_private') and owner_role.rolname<>'hotel_ld_migration_owner'
      union all select 1 from pg_catalog.pg_type as data_type join pg_catalog.pg_namespace as namespace on namespace.oid=data_type.typnamespace
        join pg_catalog.pg_roles as owner_role on owner_role.oid=data_type.typowner
        where namespace.nspname in ('public','app_private') and data_type.typtype='e' and owner_role.rolname<>'hotel_ld_migration_owner'
    ) as migration_owner_owns_all,
    actual.schemas=expected.schemas as schemas_exact,
    actual.types=expected.types as types_exact,
    actual.tables=expected.tables as tables_exact,
    actual.routines=expected.routines as routines_exact,
    actual.entrypoints=expected.entrypoints as entrypoints_exact,
    actual.policies=expected.policies as policies_exact,
    actual.triggers=expected.triggers as triggers_exact,
    not exists(select 1 from pg_catalog.unnest(expected.tables) as item(value)
      join pg_catalog.pg_class as relation on relation.oid=pg_catalog.to_regclass(item.value)
      where not relation.relrowsecurity or not relation.relforcerowsecurity) as rls_exact,
    not exists(select 1 from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
      where namespace.nspname in ('public','app_private') and relation.relkind in ('r','p','S')
        and (pg_catalog.has_table_privilege('hotel_ld_application',relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          or pg_catalog.has_any_column_privilege('hotel_ld_application',relation.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) as runtime_raw_privileges_empty,
    not pg_catalog.has_schema_privilege('hotel_ld_application','app_private','USAGE')
      and not pg_catalog.has_schema_privilege('hotel_ld_application','app_private','CREATE')
      and not pg_catalog.has_schema_privilege('hotel_ld_application','public','CREATE') as runtime_private_schema_denied,
    coalesce((select pg_catalog.array_agg(namespace.nspname||'.'||routine.proname||'('||pg_catalog.replace(pg_catalog.oidvectortypes(routine.proargtypes),' ','')||')'
      order by namespace.nspname,routine.proname,pg_catalog.oidvectortypes(routine.proargtypes))
      from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
      where namespace.nspname='public' and pg_catalog.has_function_privilege('hotel_ld_application',routine.oid,'EXECUTE')), '{}'::text[])=expected.entrypoints
      as runtime_entrypoints_exact,
    not exists(select 1 from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
      join pg_catalog.pg_roles as owner_role on owner_role.oid=routine.proowner
      where namespace.nspname='public' and (owner_role.rolname<>'hotel_ld_migration_owner' or not routine.prosecdef
        or routine.proconfig is distinct from array['search_path=""']::text[]
        or pg_catalog.has_function_privilege('public',routine.oid,'EXECUTE')))
      as definers_hardened,
    not exists(select 1 from pg_catalog.unnest(expected.audit_tables) as item(value)
      where not exists(select 1 from pg_catalog.pg_trigger as trigger
        join pg_catalog.pg_proc as trigger_routine on trigger_routine.oid=trigger.tgfoid
        join pg_catalog.pg_namespace as trigger_routine_namespace on trigger_routine_namespace.oid=trigger_routine.pronamespace
        where trigger.tgrelid=pg_catalog.to_regclass(item.value) and not trigger.tgisinternal
          and trigger.tgenabled='O' and trigger.tgtype=27
          and trigger_routine_namespace.nspname='app_private'
          and trigger_routine.proname like 'reject_%_audit_mutation')) as audit_append_only,
    not exists(select 1 from pg_catalog.pg_namespace where nspname in ('auth','storage'))
      and not exists(select 1 from pg_catalog.pg_roles where rolname in ('authenticated','anon','service_role','supabase_admin','dashboard_user','hotel_ld_people_read','hotel_ld_readonly'))
      and not exists(select 1 from pg_catalog.pg_class as relation join pg_catalog.pg_namespace as namespace on namespace.oid=relation.relnamespace
        where namespace.nspname in ('public','app_private') and relation.relname ~* '(import|provenance|commit|revert|compatibility|bridge|reset)')
      and not exists(select 1 from pg_catalog.pg_proc as routine join pg_catalog.pg_namespace as namespace on namespace.oid=routine.pronamespace
        where namespace.nspname in ('public','app_private') and routine.proname ~* '(import|provenance|commit|revert|compatibility|bridge|reset)')
      as exclusions_absent,
    true as rows_empty
  from expected cross join actual
`;

function catalogInventories(bundle) {
  return [
    asStringArray(bundle.manifest, "schemas").sort(),
    asStringArray(bundle.manifest, "types").sort(),
    asStringArray(bundle.manifest, "tables").sort(),
    asStringArray(bundle.manifest, "routines").sort(),
    asStringArray(bundle.manifest, "entrypointSignatures").map((value) => value.replace(/\s+/g, "")).sort(),
    securityDescriptorInventory(bundle.manifest, "policy", "catalog"),
    securityDescriptorInventory(bundle.manifest, "trigger"),
    asStringArray(bundle.manifest, "tables").filter((value) => value.startsWith("app_private.")).sort(),
  ];
}

function assertBootstrapIdentity(row) {
  if (
    Math.trunc(Number(row?.server_version_num) / 10_000) !== EXPECTED_NEON_TARGET.postgresMajor
    || row?.database_name !== EXPECTED_NEON_TARGET.database
    || row?.database_owner !== EXPECTED_NEON_TARGET.bootstrapRole
    || row?.current_role !== EXPECTED_NEON_TARGET.bootstrapRole
    || row?.session_role !== EXPECTED_NEON_TARGET.bootstrapRole
  ) {
    fail("CANONICAL_NEON_DATABASE_IDENTITY_MISMATCH", "connected database identity does not match the authorized PostgreSQL 18 bootstrap target");
  }
}

function assertRuntimeIdentity(row) {
  if (
    Math.trunc(Number(row?.server_version_num) / 10_000) !== EXPECTED_NEON_TARGET.postgresMajor
    || row?.database_name !== EXPECTED_NEON_TARGET.database
    || row?.database_owner !== EXPECTED_NEON_TARGET.bootstrapRole
    || row?.current_role !== "hotel_ld_application"
    || row?.session_role !== "hotel_ld_application"
  ) {
    fail("CANONICAL_NEON_RUNTIME_IDENTITY_MISMATCH", "pooled runtime identity is not the canonical application role on PostgreSQL 18");
  }
}

function assertEmptyState(row) {
  const requiredZero = [
    "application_object_count",
    "canonical_role_count",
    "forbidden_schema_count",
    "application_row_count",
    "provider_routine_count",
  ];
  if (!row || requiredZero.some((key) => Number(row[key]) !== 0)) {
    fail("CANONICAL_NEON_EMPTY_BASELINE_REQUIRED", "canonical install requires and must restore an empty baseline");
  }
}

function assertCatalogMatrix(row, expected) {
  const countDrift = Object.entries(expected).filter(([key, value]) => Number(row?.[key]) !== value);
  const verdictDrift = CATALOG_BOOLEAN_FIELDS.filter((key) => row?.[key] !== true);
  if (countDrift.length || verdictDrift.length) {
    fail("CANONICAL_NEON_CATALOG_DRIFT", `catalog validation failed (${[...countDrift.map(([key]) => key), ...verdictDrift].join(", ")})`);
  }
}

async function defaultPool(connectionString) {
  const { Pool } = await import("pg");
  return new Pool({
    connectionString,
    ssl: { rejectUnauthorized: true },
    enableChannelBinding: true,
    max: 6,
    connectionTimeoutMillis: 10_000,
  });
}

function runtimeAssert(condition, code) {
  if (!condition) fail("CANONICAL_NEON_RUNTIME_MATRIX_FAILED", code);
}

export async function runCanonicalRuntimeStage(stage, action) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(stage) || typeof action !== "function") {
    fail("CANONICAL_NEON_RUNTIME_STAGE_INVALID", "runtime stage must be a stable lowercase identifier");
  }
  try {
    return await action();
  } catch (error) {
    if (error?.code === "CANONICAL_NEON_RUNTIME_STAGE_FAILED") throw error;
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{2,80}$/.test(error.code)
      ? error.code
      : "ERROR";
    const message = typeof error?.message === "string" && /^[A-Z][A-Z0-9_:-]{1,160}$/.test(error.message)
      ? error.message
      : "REDACTED_RUNTIME_ERROR";
    fail("CANONICAL_NEON_RUNTIME_STAGE_FAILED", `${stage}:${code}:${message}`);
  }
}

function validationSeed() {
  const id = () => randomUUID();
  const suffix = id();
  return {
    tenantA: id(), propertyA: id(), domainA: id(),
    tenantB: id(), propertyB: id(), domainB: id(),
    managerProfile: id(), managerAuth: id(), managerAccount: id(),
    adminProfile: id(), adminAuth: id(), adminAccount: id(),
    managerRole: id(), adminRole: id(), managerAssignment: id(), adminAssignment: id(),
    rootDepartment: id(), childDepartment: id(), otherDepartment: id(), trainerScope: id(),
    operationalUnit: id(), departmentAlias: id(),
    positionFamily: id(), position: id(), positionAssignment: id(), positionAlias: id(),
    childEmployee: id(), otherEmployee: id(), childIdentifier: id(), otherIdentifier: id(),
    hostnameA: `${suffix}.validation.invalid`,
    hostnameB: `${id()}.validation.invalid`,
  };
}

async function withBootstrapSeedPolicies(client, tables, context, action) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    await client.query("SET LOCAL ROLE hotel_ld_migration_owner");
    await client.query(
      `select
        pg_catalog.set_config('app.actor_auth_user_id',$1::text,true),
        pg_catalog.set_config('app.actor_property_id',$2::text,true),
        pg_catalog.set_config('app.actor_request_id',$3::text,true)`,
      [context.authUserId, context.propertyId, context.requestId],
    );
    for (const table of tables) {
      runtimeAssert(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(table), "RUNTIME_SEED_TABLE_INVALID");
      await client.query(`create policy canonical_validation_owner_seed on ${table} for all to hotel_ld_migration_owner using (session_user='neondb_owner') with check (session_user='neondb_owner')`);
    }
    await action(client);
    for (const table of [...tables].reverse()) {
      await client.query(`drop policy canonical_validation_owner_seed on ${table}`);
    }
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* original error remains authoritative */ }
    }
    throw error;
  }
}

async function createRuntimeSeed(bootstrapPool, bundle) {
  const seed = validationSeed();
  const publicTables = asStringArray(bundle.manifest, "tables").filter((table) => table.startsWith("public."));
  const context = { authUserId: seed.managerAuth, propertyId: seed.propertyA, requestId: randomUUID() };
  await runWithPool(bootstrapPool, async (client) => withBootstrapSeedPolicies(client, publicTables, context, async (database) => {
    await database.query(`insert into public.tenants(id,code,name) values ($1,'validation-a','Validation A'),($2,'validation-b','Validation B')`, [seed.tenantA, seed.tenantB]);
    await database.query(`insert into public.properties(id,tenant_id,code,name_zh,name_en) values ($1,$2,'validation-a','Validation A','Validation A'),($3,$4,'validation-b','Validation B','Validation B')`, [seed.propertyA, seed.tenantA, seed.propertyB, seed.tenantB]);
    await database.query(`insert into public.property_domains(id,tenant_id,property_id,hostname) values ($1,$2,$3,$4),($5,$6,$7,$8)`, [seed.domainA, seed.tenantA, seed.propertyA, seed.hostnameA, seed.domainB, seed.tenantB, seed.propertyB, seed.hostnameB]);
    await database.query(`insert into public.profiles(id,display_name,email) values ($1,'Validation Manager',null),($2,'Validation Department Admin',null)`, [seed.managerProfile, seed.adminProfile]);
    await database.query(`insert into public.user_accounts(id,auth_user_id,user_id,tenant_id,property_id) values ($1,$2,$3,$4,$5),($6,$7,$8,$4,$5)`, [seed.managerAccount, seed.managerAuth, seed.managerProfile, seed.tenantA, seed.propertyA, seed.adminAccount, seed.adminAuth, seed.adminProfile]);
    await database.query(`insert into public.tenant_memberships(tenant_id,user_id) values ($1,$2),($1,$3)`, [seed.tenantA, seed.managerProfile, seed.adminProfile]);
    await database.query(`insert into public.property_memberships(tenant_id,property_id,user_id) values ($1,$2,$3),($1,$2,$4)`, [seed.tenantA, seed.propertyA, seed.managerProfile, seed.adminProfile]);
    await database.query(`insert into public.roles(id,tenant_id,property_id,code,scope_level) values ($1,$2,$3,'property_ld_manager','property'),($4,$2,$3,'department_trainer','department')`, [seed.managerRole, seed.tenantA, seed.propertyA, seed.adminRole]);
    await database.query(`insert into public.role_assignments(id,tenant_id,property_id,user_id,role_id) values ($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)`, [seed.managerAssignment, seed.tenantA, seed.propertyA, seed.managerProfile, seed.managerRole, seed.adminAssignment, seed.adminProfile, seed.adminRole]);
    await database.query(`insert into public.departments(id,tenant_id,property_id,parent_id,node_type,code,name_zh,name_en,sort_order) values ($1,$2,$3,null,'department','root','Validation Root','Validation Root',1)`, [seed.rootDepartment, seed.tenantA, seed.propertyA]);
    await database.query(`insert into public.departments(id,tenant_id,property_id,parent_id,node_type,code,name_zh,name_en,sort_order) values ($1,$2,$3,$4,'team','child','Validation Child','Validation Child',2),($5,$2,$3,null,'department','other','Validation Other','Validation Other',3)`, [seed.childDepartment, seed.tenantA, seed.propertyA, seed.rootDepartment, seed.otherDepartment]);
    await database.query(`insert into public.operational_units(id,tenant_id,property_id,department_id,unit_type,code,name_zh,name_en) values ($1,$2,$3,$4,'other','validation-unit','Validation Unit','Validation Unit')`, [seed.operationalUnit, seed.tenantA, seed.propertyA, seed.childDepartment]);
    await database.query(`insert into public.department_aliases(id,tenant_id,property_id,source_system,source_sheet,source_value,normalized_source_value,suggested_target_id) values ($1,$2,$3,'validation','fixture','Validation Department Alias','validation department alias',$4)`, [seed.departmentAlias, seed.tenantA, seed.propertyA, seed.childDepartment]);
    await database.query(`insert into public.trainer_scopes(id,tenant_id,property_id,role_assignment_id,department_id,include_descendants) values ($1,$2,$3,$4,$5,true)`, [seed.trainerScope, seed.tenantA, seed.propertyA, seed.adminAssignment, seed.rootDepartment]);
    await database.query(`insert into public.position_families(id,tenant_id,property_id,code,name_zh,name_en) values ($1,$2,$3,'validation-family','Validation Family','Validation Family')`, [seed.positionFamily, seed.tenantA, seed.propertyA]);
    await database.query(`insert into public.positions(id,tenant_id,property_id,position_family_id,code,name_zh,name_en) values ($1,$2,$3,$4,'validation-position','Validation Position','Validation Position')`, [seed.position, seed.tenantA, seed.propertyA, seed.positionFamily]);
    await database.query(`insert into public.position_aliases(id,tenant_id,property_id,source_system,source_sheet,source_value,normalized_source_value,suggested_position_id,suggested_family_id) values ($1,$2,$3,'validation','fixture','Validation Position Alias','validation position alias',$4,$5)`, [seed.positionAlias, seed.tenantA, seed.propertyA, seed.position, seed.positionFamily]);
    await database.query(`insert into public.position_department_assignments(id,tenant_id,property_id,position_id,department_id) values ($1,$2,$3,$4,$5)`, [seed.positionAssignment, seed.tenantA, seed.propertyA, seed.position, seed.childDepartment]);
    await database.query(`insert into public.employees(id,tenant_id,property_id,employee_number,name_zh,department_id,position_id,position_family_id,employment_status) values ($1,$2,$3,'validation-child','Validation Child Employee',$4,$5,$6,'active'),($7,$2,$3,'validation-other','Validation Other Employee',$8,$5,$6,'active')`, [seed.childEmployee, seed.tenantA, seed.propertyA, seed.childDepartment, seed.position, seed.positionFamily, seed.otherEmployee, seed.otherDepartment]);
    await database.query(`insert into public.employee_external_identifiers(id,tenant_id,property_id,employee_id,source_system,identifier_type,identifier_value,is_primary) values ($1,$2,$3,$4,'validation','other','validation-child',true),($5,$2,$3,$6,'validation','other','validation-other',true)`, [seed.childIdentifier, seed.tenantA, seed.propertyA, seed.childEmployee, seed.otherIdentifier, seed.otherEmployee]);
  }));
  return seed;
}

async function cleanupRuntimeSeed(bootstrapPool, bundle, seed) {
  const publicTables = asStringArray(bundle.manifest, "tables").filter((table) => table.startsWith("public."));
  const context = { authUserId: seed.managerAuth, propertyId: seed.propertyA, requestId: randomUUID() };
  await runWithPool(bootstrapPool, async (client) => withBootstrapSeedPolicies(client, publicTables, context, async (database) => {
    const tenantTables = [
      "public.employee_external_identifiers", "public.employees", "public.position_department_assignments",
      "public.position_aliases", "public.positions", "public.position_families", "public.operational_unit_aliases",
      "public.operational_units", "public.department_aliases", "public.trainer_scopes", "public.department_closure",
      "public.departments", "public.role_assignments", "public.roles", "public.property_memberships",
      "public.tenant_memberships", "public.user_accounts", "public.property_domains", "public.properties",
    ];
    for (const table of tenantTables) await database.query(`delete from ${table} where tenant_id=any($1::uuid[])`, [[seed.tenantA, seed.tenantB]]);
    await database.query("delete from public.profiles where id=any($1::uuid[])", [[seed.managerProfile, seed.adminProfile]]);
    await database.query("delete from public.tenants where id=any($1::uuid[])", [[seed.tenantA, seed.tenantB]]);
  }));
}

class RuntimeRollback extends Error {
  constructor(value) { super("CANONICAL_RUNTIME_ROLLBACK"); this.value = value; }
}

async function rolledBackActor(withActor, input, pool, action) {
  try {
    await withActor(input, async (database) => { throw new RuntimeRollback(await action(database)); }, pool);
  } catch (error) {
    if (error instanceof RuntimeRollback) return error.value;
    throw error;
  }
  fail("CANONICAL_NEON_RUNTIME_MATRIX_FAILED", "RUNTIME_ROLLBACK_SENTINEL_MISSING");
}

async function expectedRuntimeFailure(action, acceptedCodes = []) {
  try {
    await action();
  } catch (error) {
    if (acceptedCodes.length === 0 || acceptedCodes.includes(error?.code) || acceptedCodes.some((code) => error?.message?.includes(code))) return error;
    throw error;
  }
  fail("CANONICAL_NEON_RUNTIME_MATRIX_FAILED", "EXPECTED_RUNTIME_DENIAL_MISSING");
}

function actor(seed, kind = "manager", propertyId = seed.propertyA) {
  return {
    authUserId: kind === "manager" ? seed.managerAuth : seed.adminAuth,
    propertyId,
    requestId: randomUUID(),
  };
}

export function runtimeSmokeValues(signature, seed) {
  const unique = () => `validation-${randomUUID()}`;
  const fixtures = {
    "public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)":
      () => [seed.hostnameA, seed.tenantA, seed.propertyA, seed.rootDepartment, "team", unique(), "Validation Smoke", "Validation Smoke", 10],
    "public.create_neon_organization_department_from_alias(text,uuid,text,uuid,text,text,text,text,integer)":
      () => [seed.hostnameA, seed.departmentAlias, "created_top_level", null, "department", unique(), "Validation Smoke", "Validation Smoke", 10],
    "public.create_neon_organization_operational_unit(text,uuid,uuid,uuid,uuid,text,text,text,text,integer,boolean)":
      () => [seed.hostnameA, seed.tenantA, seed.propertyA, seed.rootDepartment, null, "other", unique(), "Validation Smoke", "Validation Smoke", 10, true],
    "public.merge_neon_organization_department_alias(text,uuid,uuid)":
      () => [seed.hostnameA, seed.departmentAlias, seed.childDepartment],
    "public.move_neon_organization_department(text,uuid,uuid,bigint)":
      () => [seed.hostnameA, seed.childDepartment, seed.rootDepartment, 1],
    "public.preview_neon_organization_department_move(text,uuid,uuid)":
      () => [seed.hostnameA, seed.childDepartment, seed.rootDepartment],
    "public.preview_neon_position_source_impact(text,uuid)": () => [seed.hostnameA, seed.positionAlias],
    "public.read_neon_organization_department_aliases(text)": () => [seed.hostnameA],
    "public.read_neon_organization_department_tree(text)": () => [seed.hostnameA],
    "public.read_neon_organization_operational_units(text)": () => [seed.hostnameA],
    "public.read_neon_people_department_directory(text,text,integer,integer)": () => [seed.hostnameA, null, 100, 0],
    "public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)":
      () => [seed.hostnameA, null, null, null, null, null, null, 100, 0],
    "public.read_neon_people_manager_employee(text,uuid)": () => [seed.hostnameA, seed.childEmployee],
    "public.read_neon_people_manager_facets(text)": () => [seed.hostnameA],
    "public.read_neon_position_families(text)": () => [seed.hostnameA],
    "public.read_neon_position_source_labels(text)": () => [seed.hostnameA],
    "public.read_neon_positions(text)": () => [seed.hostnameA],
    "public.resolve_neon_organization_department_alias(text,uuid,text,uuid)":
      () => [seed.hostnameA, seed.departmentAlias, "department", seed.childDepartment],
    "public.resolve_neon_organization_department_alias_to_operational_unit(text,uuid,uuid)":
      () => [seed.hostnameA, seed.departmentAlias, seed.operationalUnit],
    "public.resolve_neon_organization_property(text)": () => [seed.hostnameA],
    "public.resolve_neon_people_property(text)": () => [seed.hostnameA],
    "public.resolve_neon_position_alias(text,uuid,text,uuid,text,text)":
      () => [seed.hostnameA, seed.positionAlias, "position", seed.position, null, null],
    "public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)":
      () => [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, unique(), "Validation Smoke", "Validation Smoke", seed.childDepartment, seed.operationalUnit, seed.position, seed.positionFamily, null, null, null, "active", true, JSON.stringify([])],
    "public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean)":
      () => [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, unique(), "Validation Smoke", "Validation Smoke", "Validation Smoke", 10, true],
    "public.save_neon_position_with_departments(text,uuid,uuid,uuid,bigint,uuid,text,text,text,text,boolean,uuid[])":
      () => [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, seed.positionFamily, unique(), "Validation Smoke", "Validation Smoke", null, true, [seed.childDepartment]],
    "public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)":
      () => [seed.hostnameA, seed.childDepartment, 1, "Validation Child", "Validation Child", 2, true],
    "public.update_neon_organization_operational_unit(text,uuid,bigint,uuid,uuid,text,text,text,text,integer,boolean)":
      () => [seed.hostnameA, seed.operationalUnit, 1, seed.childDepartment, null, "other", "validation-unit", "Validation Unit", "Validation Unit", 10, true],
  };
  const normalized = normalizeIdentifier(signature).replace(/\s+/g, "");
  const fixture = fixtures[normalized];
  if (!fixture) fail("CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT", "runtime smoke has no exact-signature fixture");
  return fixture();
}

export function runtimeEntrypointQuery(manifest, signature, values) {
  const normalized = normalizeIdentifier(signature).replace(/\s+/g, "");
  const declared = new Set(asStringArray(manifest, "entrypointSignatures").map((value) => value.replace(/\s+/g, "")));
  if (!declared.has(normalized)) {
    fail("CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT", "runtime query signature is not declared by the canonical manifest");
  }
  const match = normalized.match(/^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\((.*)\)$/);
  if (!match) fail("CANONICAL_NEON_ENTRYPOINT_SIGNATURE_DRIFT", "runtime query signature is invalid");
  const types = match[2] ? match[2].split(",") : [];
  if (!Array.isArray(values) || values.length !== types.length) {
    fail("CANONICAL_NEON_ENTRYPOINT_ARGUMENT_DRIFT", "runtime query values must match the exact manifest signature");
  }
  return {
    text: `select ${match[1]}(${types.map((type, index) => `$${index + 1}::${type}`).join(",")}) as payload`,
    values,
  };
}

export function assertExpectedSmokeRejection(manifest, signature, error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const message = typeof error?.message === "string" ? error.message : "";
  if (/^(?:42|3F|XX)/.test(code) || code === "42501" || /permission denied/i.test(message)) throw error;
  const normalized = normalizeIdentifier(signature).replace(/\s+/g, "");
  const allowed = manifest.security?.runtimeSmokeExpectedRejections?.[normalized] ?? [];
  if (allowed.some((rejection) => rejection.code === code && rejection.message === message)) return;
  throw error;
}

async function smokeAllEntrypoints(withActor, runtimePool, seed, bundle) {
  const smoked = new Set();
  for (const signature of asStringArray(bundle.manifest, "entrypointSignatures")) {
    const match = signature.match(/^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\((.*)\)$/);
    runtimeAssert(match, "ENTRYPOINT_SIGNATURE_INVALID");
    const types = match[2] ? match[2].split(",") : [];
    const values = runtimeSmokeValues(signature, seed);
    try {
      await rolledBackActor(withActor, actor(seed), runtimePool, (database) => database.query(
        runtimeEntrypointQuery(bundle.manifest, signature, values),
      ));
    } catch (error) {
      assertExpectedSmokeRejection(bundle.manifest, signature, error);
    }
    smoked.add(signature);
  }
  runtimeAssert(smoked.size === asStringArray(bundle.manifest, "entrypointSignatures").length, "ENTRYPOINT_SMOKE_INCOMPLETE");
}

async function runCanonicalRuntimeMatrix({ bootstrapPool, runtimePool, bundle }) {
  const { withNeonActorContext, withNeonResolvedActorContext } = await import("../../app/lib/neon/actor-context.ts");
  const seed = await runCanonicalRuntimeStage("seed-create", () => createRuntimeSeed(bootstrapPool, bundle));
  try {
    await runCanonicalRuntimeStage("actor-context-reuse", async () => {
      const reusedClient = await runtimePool.connect();
      const pinnedPool = {
        async connect() {
          return {
            query: (...argumentsList) => reusedClient.query(...argumentsList),
            release() { /* released once after both real helper calls */ },
          };
        },
      };
      try {
        const committedActor = await withNeonActorContext(
          actor(seed),
          async (database) => (await database.query("select pg_catalog.current_setting('app.actor_auth_user_id') as actor")).rows[0].actor,
          pinnedPool,
        );
        const afterCommitClear = (await reusedClient.query(`
          select (
            nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_auth_user_id',true)),'') is null
            and nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_property_id',true)),'') is null
            and nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_request_id',true)),'') is null
          ) as after_commit_clear
        `)).rows[0].after_commit_clear;
        const rolledBackActorId = await rolledBackActor(
          withNeonActorContext,
          actor(seed, "admin"),
          pinnedPool,
          async (database) => (await database.query("select pg_catalog.current_setting('app.actor_auth_user_id') as actor")).rows[0].actor,
        );
        const afterRollbackClear = (await reusedClient.query(`
          select (
            nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_auth_user_id',true)),'') is null
            and nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_property_id',true)),'') is null
            and nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_request_id',true)),'') is null
          ) as after_rollback_clear
        `)).rows[0].after_rollback_clear;
        runtimeAssert(
          committedActor === seed.managerAuth
            && rolledBackActorId === seed.adminAuth
            && afterCommitClear === true
            && afterRollbackClear === true,
          "RUNTIME_CONNECTION_REUSE_CLEANUP_FAILED",
        );
      } finally {
        reusedClient.release();
      }
    });

    const resolved = await runCanonicalRuntimeStage("resolved-actor", () => withNeonResolvedActorContext(
      { authUserId: seed.managerAuth, requestId: randomUUID() },
      async (database) => (await database.query("select property_id from public.resolve_neon_people_property($1::text)", [seed.hostnameA])).rows[0].property_id,
      async (database) => (await database.query("select pg_catalog.current_setting('app.actor_property_id',true) as property_id")).rows[0].property_id,
      runtimePool,
    ));
    runtimeAssert(resolved === seed.propertyA, "RESOLVED_ACTOR_CONTEXT_FAILED");

    const managerReads = await runCanonicalRuntimeStage("manager-reads", () => rolledBackActor(withNeonActorContext, actor(seed), runtimePool, async (database) => {
      const people = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_people_manager_directory(text,text,uuid,uuid,uuid,text,boolean,integer,integer)",
        [seed.hostnameA, null, null, null, null, null, null, 100, 0],
      ))).rows[0].payload;
      const organization = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_organization_department_tree(text)",
        [seed.hostnameA],
      ))).rows[0].payload;
      const positions = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_positions(text)",
        [seed.hostnameA],
      ))).rows[0].payload;
      return { people, organization, positions };
    }));
    runtimeAssert(managerReads.people.rows.length === 2 && managerReads.organization.rows.length === 3 && managerReads.positions.rows.length === 1, "MANAGER_READ_SCOPE_FAILED");

    const adminReads = await runCanonicalRuntimeStage("department-admin-reads", () => rolledBackActor(withNeonActorContext, actor(seed, "admin"), runtimePool, async (database) => {
      const people = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_people_department_directory(text,text,integer,integer)",
        [seed.hostnameA, null, 100, 0],
      ))).rows[0].payload;
      const organization = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_organization_department_tree(text)",
        [seed.hostnameA],
      ))).rows[0].payload;
      const positions = (await database.query(runtimeEntrypointQuery(
        bundle.manifest,
        "public.read_neon_positions(text)",
        [seed.hostnameA],
      ))).rows[0].payload;
      return { people, organization, positions };
    }));
    runtimeAssert(adminReads.people.rows.length === 1 && adminReads.people.rows[0].department_id === seed.childDepartment, "DEPARTMENT_PEOPLE_SCOPE_FAILED");
    runtimeAssert(adminReads.organization.rows.length === 2 && adminReads.positions.rows.length === 1, "DEPARTMENT_ORGANIZATION_POSITION_SCOPE_FAILED");

    await runCanonicalRuntimeStage("scope-denials", async () => {
      await expectedRuntimeFailure(
        () => rolledBackActor(withNeonActorContext, actor(seed, "manager", seed.propertyB), runtimePool, (database) => database.query(runtimeEntrypointQuery(
          bundle.manifest,
          "public.read_neon_people_manager_facets(text)",
          [seed.hostnameB],
        ))),
        ["42501", "NEON_PEOPLE_MANAGER_REQUIRED"],
      );
      await expectedRuntimeFailure(
        () => withNeonResolvedActorContext(
          { authUserId: seed.managerAuth, requestId: randomUUID() },
          async (database) => {
            const row = (await database.query("select property_id from public.resolve_neon_people_property($1::text)", [`${randomUUID()}.unknown.invalid`])).rows[0];
            if (!row) throw new Error("UNKNOWN_PROPERTY_DENIED");
            return row.property_id;
          },
          async () => null,
          runtimePool,
        ),
        ["UNKNOWN_PROPERTY_DENIED"],
      );
    });

    await runCanonicalRuntimeStage("rollback-writes", async () => {
      await rolledBackActor(withNeonActorContext, actor(seed), runtimePool, (database) => database.query(
        runtimeEntrypointQuery(
          bundle.manifest,
          "public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)",
          [seed.hostnameA, seed.tenantA, seed.propertyA, null, "department", randomUUID(), "Validation Write", "Validation Write", 10],
        ),
      ));
      await rolledBackActor(withNeonActorContext, actor(seed), runtimePool, (database) => database.query(
        runtimeEntrypointQuery(
          bundle.manifest,
          "public.save_neon_position_family(text,uuid,uuid,uuid,bigint,text,text,text,text,integer,boolean)",
          [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, randomUUID(), "Validation Write", "Validation Write", "Validation Write", 10, true],
        ),
      ));
      await rolledBackActor(withNeonActorContext, actor(seed), runtimePool, (database) => database.query(
        runtimeEntrypointQuery(
          bundle.manifest,
          "public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)",
          [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, randomUUID(), "Validation Write", "Validation Write", seed.childDepartment, null, seed.position, seed.positionFamily, null, null, null, "active", true, JSON.stringify([])],
        ),
      ));
    });

    await runCanonicalRuntimeStage("conflict-atomicity", async () => {
      await expectedRuntimeFailure(
        () => rolledBackActor(withNeonActorContext, actor(seed), runtimePool, (database) => database.query(
          runtimeEntrypointQuery(
            bundle.manifest,
            "public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)",
            [seed.hostnameA, seed.tenantA, seed.propertyA, seed.childEmployee, 99, "validation-child", "Validation Child Employee", null, seed.childDepartment, null, seed.position, seed.positionFamily, null, null, null, "active", true, JSON.stringify([])],
          ),
        )),
        ["40001", "NEON_EMPLOYEE_WRITE_STALE"],
      );
      await expectedRuntimeFailure(
        () => rolledBackActor(withNeonActorContext, actor(seed), runtimePool, (database) => database.query(
          runtimeEntrypointQuery(
            bundle.manifest,
            "public.save_neon_employee_with_identifiers(text,uuid,uuid,uuid,bigint,text,text,text,uuid,uuid,uuid,uuid,text,date,date,text,boolean,jsonb)",
            [seed.hostnameA, seed.tenantA, seed.propertyA, null, 0, randomUUID(), "Validation Conflict", null, seed.childDepartment, null, seed.position, seed.positionFamily, null, null, null, "active", true, JSON.stringify([{ source_system: "validation", identifier_type: "other", identifier_value: "validation-child", is_primary: true, is_active: true }])],
          ),
        )),
        ["40001", "NEON_EMPLOYEE_WRITE_IDENTIFIER_CONFLICT"],
      );
    });

    await runCanonicalRuntimeStage("raw-access-denials", async () => {
      const rawClient = await runtimePool.connect();
      try {
        for (const sql of [
          "select * from public.properties",
          "insert into public.tenants(id,code,name) values (pg_catalog.gen_random_uuid(),'denied','denied')",
          "update public.tenants set name='denied'",
          "delete from public.tenants",
          "select app_private.current_actor_auth_user_id()",
        ]) await expectedRuntimeFailure(() => rawClient.query(sql), ["42501"]);
      } finally {
        rawClient.release();
      }
    });

    const isolated = await runCanonicalRuntimeStage("concurrent-isolation", () => Promise.all([
      withNeonActorContext(actor(seed), async (database) => (await database.query("select pg_catalog.current_setting('app.actor_auth_user_id') as actor,pg_catalog.pg_sleep(0.05)")).rows[0].actor, runtimePool),
      withNeonActorContext(actor(seed, "admin"), async (database) => (await database.query("select pg_catalog.current_setting('app.actor_auth_user_id') as actor,pg_catalog.pg_sleep(0.05)")).rows[0].actor, runtimePool),
    ]));
    runtimeAssert(new Set(isolated).size === 2 && isolated.includes(seed.managerAuth) && isolated.includes(seed.adminAuth), "CONCURRENT_ACTOR_ISOLATION_FAILED");

    await runCanonicalRuntimeStage("entrypoint-smoke", () => smokeAllEntrypoints(withNeonActorContext, runtimePool, seed, bundle));
    return {
      actorContext: "PASS", resolvedActorContext: "PASS", managerReads: "PASS",
      departmentAdminScope: "PASS", crossScopeDenials: "PASS", rollbackWrites: "PASS",
      conflictAtomicity: "PASS", rawAccessDenied: "PASS", concurrentIsolation: "PASS", cleanup: "PASS",
    };
  } finally {
    await runCanonicalRuntimeStage("seed-cleanup", () => cleanupRuntimeSeed(bootstrapPool, bundle, seed));
  }
}

function resolvedDependencies(overrides = {}) {
  return {
    createBootstrapPool: (connectionString) => defaultPool(connectionString),
    createRuntimePool: (connectionString) => defaultPool(connectionString),
    randomPassword: () => randomBytes(36).toString("base64url"),
    runRuntimeMatrix: runCanonicalRuntimeMatrix,
    ...overrides,
  };
}

async function closePool(pool) {
  if (typeof pool?.end === "function") await pool.end();
}

async function runWithPool(pool, action) {
  const client = await pool.connect();
  try {
    return await action(client);
  } finally {
    client.release();
  }
}

async function readIdentity(client) {
  const result = await client.query(TARGET_IDENTITY_SQL);
  return result.rows[0];
}

async function readEmptyState(client) {
  const result = await client.query(EMPTY_STATE_SQL);
  return result.rows[0];
}

async function readCatalog(client, bundle) {
  const inventories = catalogInventories(bundle);
  const result = await client.query({ text: CATALOG_MATRIX_SQL, values: inventories });
  const tables = inventories[2];
  if (tables.some((value) => !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(value))) {
    fail("CANONICAL_NEON_INVALID_MANIFEST", "catalog row inventory contains an unsafe qualified identifier");
  }
  const rowResult = await client.query(`
    /* canonical_row_counts */
    ${tables.map((value) => {
      const [schema, table] = value.split(".");
      return `select '${schema}.${table}'::text as table_name, count(*)::bigint as row_count from "${schema}"."${table}"`;
    }).join("\nunion all\n")}
  `);
  const auditTables = new Set(inventories[7]);
  const row = result.rows[0];
  row.application_row_count = rowResult.rows.reduce((sum, item) => sum + Number(item.row_count), 0);
  row.audit_row_count = rowResult.rows.reduce((sum, item) => sum + (auditTables.has(item.table_name) ? Number(item.row_count) : 0), 0);
  row.rows_empty = row.application_row_count === 0;
  const expected = expectedCatalogCounts(bundle.manifest, bundle.modules);
  assertCatalogMatrix(row, expected);
  return expected;
}

async function executeInstall(client, bundle, { rollback }) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    assertEmptyState(await readEmptyState(client));
    for (const module of bundle.modules) await client.query(module.source);
    await client.query("RESET ROLE");
    const counts = await readCatalog(client, bundle);
    await client.query(rollback ? "ROLLBACK" : "COMMIT");
    transactionOpen = false;
    if (rollback) assertEmptyState(await readEmptyState(client));
    return counts;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* connection close is the remaining safe action */ }
    }
    throw error;
  }
}

async function provisionRuntimePassword(client, password) {
  await client.query("BEGIN");
  let transactionOpen = true;
  try {
    await client.query(
      "select pg_catalog.set_config('app.canonical_runtime_password', $1::text, true)",
      [password],
    );
    await client.query(`
      do $password$
      begin
        execute pg_catalog.format(
          'alter role %I password %L',
          'hotel_ld_application',
          pg_catalog.current_setting('app.canonical_runtime_password')
        );
      end
      $password$
    `);
    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch { /* connection close is the remaining safe action */ }
    }
    throw error;
  }
}

export async function validateCanonicalNeon({
  mode = "source",
  root = DEFAULT_ROOT,
  target,
  bootstrapConnectionString,
  runtimeConnectionString,
  runtimePassword,
  dependencies,
} = {}) {
  if (!VALID_MODES.has(mode)) fail("CANONICAL_NEON_UNKNOWN_MODE", `unknown mode: ${mode}`);
  const sourceResult = await validateCanonicalNeonSource({ root });
  if (!DATABASE_MODES.has(mode)) return sourceResult;

  const expectedTarget = assertExpectedTarget(target);
  parseConnectionTarget(bootstrapConnectionString, "bootstrap", expectedTarget);
  if (mode === "runtime") parseConnectionTarget(runtimeConnectionString, "runtime", expectedTarget);
  const bundle = await loadDatabaseBundle(root);
  const injected = resolvedDependencies(dependencies);

  if (mode === "runtime") {
    const bootstrapPool = await injected.createBootstrapPool(bootstrapConnectionString);
    let runtimePool;
    try {
      runtimePool = await injected.createRuntimePool(runtimeConnectionString);
      await runWithPool(bootstrapPool, async (client) => {
        assertBootstrapIdentity(await readIdentity(client));
        await readCatalog(client, bundle);
      });
      await runWithPool(runtimePool, async (client) => assertRuntimeIdentity(await readIdentity(client)));
      const matrix = await injected.runRuntimeMatrix({ bootstrapPool, runtimePool, bundle });
      await runWithPool(bootstrapPool, async (client) => await readCatalog(client, bundle));
      return { mode, matrix, finalRowsZero: true };
    } finally {
      if (runtimePool) await closePool(runtimePool);
      await closePool(bootstrapPool);
    }
  }

  const pool = await injected.createBootstrapPool(bootstrapConnectionString);
  try {
    return await runWithPool(pool, async (client) => {
      assertBootstrapIdentity(await readIdentity(client));
      if (mode === "dry-run") {
        return { mode, counts: await executeInstall(client, bundle, { rollback: true }), rolledBack: true };
      }
      if (mode === "catalog") {
        return { mode, counts: await readCatalog(client, bundle), rowsEmpty: true };
      }
      if (mode === "apply") {
        const counts = await executeInstall(client, bundle, { rollback: false });
        await provisionRuntimePassword(client, runtimePassword ?? injected.randomPassword());
        return { mode, counts, runtimeCredentialProvisioned: true };
      }
      const first = await executeInstall(client, bundle, { rollback: true });
      const second = await executeInstall(client, bundle, { rollback: true });
      if (JSON.stringify(first) !== JSON.stringify(second)) {
        fail("CANONICAL_NEON_REPEATABILITY_DRIFT", "successive full dry-runs produced different catalog evidence");
      }
      const counts = await executeInstall(client, bundle, { rollback: false });
      await provisionRuntimePassword(client, runtimePassword ?? injected.randomPassword());
      await readCatalog(client, bundle);
      return {
        mode,
        counts,
        dryRuns: 2,
        identical: true,
        applied: true,
        runtimeCredentialProvisioned: true,
      };
    });
  } finally {
    await closePool(pool);
  }
}

function parseCli(argv) {
  const [mode = "source", ...rest] = argv;
  let root = DEFAULT_ROOT;
  let credentialsStdin = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--root" && rest[index + 1]) {
      root = rest[index + 1];
      index += 1;
    } else if (rest[index] === "--credentials-stdin") {
      credentialsStdin = true;
    } else {
      fail("CANONICAL_NEON_INVALID_ARGUMENT", `unknown argument: ${rest[index]}`);
    }
  }
  return { mode, root, credentialsStdin };
}

function targetFromEnvironment(environment) {
  const postgresMajor = Number.parseInt(environment.NEON_POSTGRES_MAJOR ?? "", 10);
  return {
    projectName: environment.NEON_PROJECT_NAME,
    projectId: environment.NEON_PROJECT_ID,
    branchName: environment.NEON_BRANCH_NAME,
    branchId: environment.NEON_BRANCH_ID,
    endpointId: environment.NEON_ENDPOINT_ID,
    database: environment.PGDATABASE,
    bootstrapRole: environment.NEON_BOOTSTRAP_ROLE,
    postgresMajor,
  };
}

async function credentialsFromStdin(enabled) {
  if (!enabled) return {};
  let parsed;
  try {
    const input = createInterface({ input: process.stdin, terminal: false });
    let line;
    for await (const candidate of input) {
      line = candidate;
      input.close();
      break;
    }
    parsed = JSON.parse(line ?? "");
  } catch {
    fail("CANONICAL_NEON_CREDENTIAL_INPUT_INVALID", "credential stdin must be one valid JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("CANONICAL_NEON_CREDENTIAL_INPUT_INVALID", "credential stdin must be one valid JSON object");
  }
  return {
    bootstrapConnectionString: parsed.bootstrapConnectionString,
    runtimeConnectionString: parsed.runtimeConnectionString,
    runtimePassword: parsed.runtimePassword,
  };
}

async function main() {
  try {
    const parsed = parseCli(process.argv.slice(2));
    const credentials = await credentialsFromStdin(parsed.credentialsStdin);
    const result = await validateCanonicalNeon({
      mode: parsed.mode,
      root: parsed.root,
      ...(DATABASE_MODES.has(parsed.mode) ? { target: targetFromEnvironment(process.env), ...credentials } : {}),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const code = error instanceof CanonicalNeonValidationError ? error.code : "CANONICAL_NEON_VALIDATION_FAILED";
    process.stderr.write(`${code}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
