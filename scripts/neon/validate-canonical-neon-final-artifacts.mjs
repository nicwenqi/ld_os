#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SECRET_PATTERNS = [
  { label: "DATABASE_URL", pattern: /\b(?:DATABASE_URL|NEON_BOOTSTRAP_DATABASE_URL|NEON_RUNTIME_DATABASE_URL)\b/ },
  { label: "database connection URI", pattern: /\bpostgres(?:ql)?:\/\//i },
  { label: "database credential", pattern: /\bNEON_[A-Z0-9_]*(?:PASSWORD|SECRET|CREDENTIAL)[A-Z0-9_]*\b/ },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const PG_BUNDLE_PATTERNS = [
  /\bpg-protocol\b/i,
  /\bpg-pool\b/i,
  /\bnode-postgres\b/i,
  /\bSCRAM-SHA-256\b/,
  /@neondatabase\/(?:serverless|neon-js)/i,
];

export async function validateCanonicalFinalArtifacts({
  root,
  manifestPath = "neon/canonical/manifest.json",
  browserBundlePath = "dist/client",
} = {}) {
  const resolvedRoot = path.resolve(root ?? process.cwd());
  const manifest = JSON.parse(await readFile(within(resolvedRoot, manifestPath), "utf8"));
  const contracts = validateManifestShape(manifest.applicationContracts);

  let repositories = 0;
  let repositoryMethods = 0;
  let apiRoutes = 0;
  const browserEntries = new Set();

  for (const domain of contracts) {
    for (const repository of domain.repositories) {
      const source = await readRequiredSource(resolvedRoot, repository.path);
      const actual = interfaceMethods(source, repository.interface, repository.path);
      assertExactSet(
        actual,
        repository.methods,
        `repository ${repository.interface} (${repository.path})`,
      );
      repositories += 1;
      repositoryMethods += actual.length;
    }
    for (const adapter of domain.adapters) {
      await readRequiredSource(resolvedRoot, adapter);
      browserEntries.add(within(resolvedRoot, adapter));
    }
    for (const route of domain.apiRoutes) {
      const source = await readRequiredSource(resolvedRoot, route.path);
      const actual = exportedHttpMethods(source);
      assertExactSet(actual, route.methods, `API route ${route.path}`);
      apiRoutes += 1;
    }
  }

  const appRoot = within(resolvedRoot, "app");
  if (await exists(appRoot)) {
    for (const sourcePath of await listFiles(appRoot)) {
      if (!SOURCE_EXTENSIONS.includes(path.extname(sourcePath))) continue;
      const source = await readFile(sourcePath, "utf8");
      if (/^\s*["']use client["'];?/m.test(source)) browserEntries.add(sourcePath);
    }
  }

  const browserSourceFiles = await validateBrowserSourceGraph(resolvedRoot, browserEntries);
  const browserBundleFiles = await validateBrowserBundle(
    resolvedRoot,
    within(resolvedRoot, browserBundlePath),
  );

  return {
    domains: contracts.length,
    repositories,
    repositoryMethods,
    apiRoutes,
    browserSourceFiles,
    browserBundleFiles,
  };
}

function validateManifestShape(value) {
  if (!Array.isArray(value) || value.length === 0) {
    contractError("manifest.applicationContracts must be a non-empty array");
  }
  const domains = new Set();
  for (const domain of value) {
    if (!domain || typeof domain !== "object" || typeof domain.domain !== "string") {
      contractError("each application contract requires a domain");
    }
    if (domains.has(domain.domain)) contractError(`duplicate domain ${domain.domain}`);
    domains.add(domain.domain);
    if (!Array.isArray(domain.repositories) || domain.repositories.length === 0) {
      contractError(`${domain.domain} requires repositories`);
    }
    if (!Array.isArray(domain.adapters) || !Array.isArray(domain.apiRoutes)) {
      contractError(`${domain.domain} requires adapters and apiRoutes`);
    }
    for (const repository of domain.repositories) {
      if (
        typeof repository?.path !== "string"
        || typeof repository.interface !== "string"
        || !nonEmptyUniqueStrings(repository.methods)
      ) contractError(`${domain.domain} contains an invalid repository contract`);
    }
    if (!nonEmptyUniqueStrings(domain.adapters)) {
      contractError(`${domain.domain} contains invalid adapters`);
    }
    for (const route of domain.apiRoutes) {
      if (
        typeof route?.path !== "string"
        || !nonEmptyUniqueStrings(route.methods)
        || route.methods.some(method => !HTTP_METHODS.includes(method))
      ) contractError(`${domain.domain} contains an invalid API route contract`);
    }
  }
  return value;
}

function nonEmptyUniqueStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(item => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function interfaceMethods(source, interfaceName, sourcePath) {
  const escaped = interfaceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`export\\s+interface\\s+${escaped}(?:\\s+extends[^\\{]+)?\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (!match) contractError(`interface ${interfaceName} not found in ${sourcePath}`);
  return [...match[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map(result => result[1]);
}

function exportedHttpMethods(source) {
  const methods = [];
  const pattern = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  for (const match of source.matchAll(pattern)) methods.push(match[1]);
  return methods;
}

function assertExactSet(actual, expected, label) {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected)].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    contractError(`${label} expected [${expectedSorted.join(", ")}], found [${actualSorted.join(", ")}]`);
  }
}

async function validateBrowserSourceGraph(root, entries) {
  const visited = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const source = await readRequiredSource(root, path.relative(root, sourcePath));
    assertNoSecrets(source, path.relative(root, sourcePath));

    for (const specifier of runtimeImportSpecifiers(source)) {
      if (isPgClientSpecifier(specifier)) {
        leakError(`${path.relative(root, sourcePath)} imports pg client package ${specifier}`);
      }
      if (!specifier.startsWith(".")) continue;
      const resolved = await resolveLocalImport(sourcePath, specifier);
      if (!resolved) contractError(`${path.relative(root, sourcePath)} has unresolved import ${specifier}`);
      if (!withinRoot(root, resolved)) leakError(`${path.relative(root, sourcePath)} imports outside the application root`);
      pending.push(resolved);
    }
  }
  return visited.size;
}

function runtimeImportSpecifiers(source) {
  const imports = [];
  const staticPattern = /(?:^|\n)\s*(?:import(?!\s+type\b)(?:[\s\S]*?\sfrom\s*)?|export\s+(?:\*|\{[^}]*\})\s+from\s*)["']([^"']+)["']/g;
  const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(staticPattern)) imports.push(match[1]);
  for (const match of source.matchAll(dynamicPattern)) imports.push(match[1]);
  return imports;
}

function isPgClientSpecifier(specifier) {
  return specifier === "pg"
    || specifier.startsWith("pg/")
    || /^@neondatabase\/(?:serverless|neon-js)(?:\/|$)/.test(specifier);
}

async function resolveLocalImport(importer, specifier) {
  const candidate = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(candidate)
    ? [candidate]
    : [
        ...SOURCE_EXTENSIONS.map(extension => `${candidate}${extension}`),
        ...SOURCE_EXTENSIONS.map(extension => path.join(candidate, `index${extension}`)),
      ];
  for (const pathCandidate of candidates) {
    if (await isFile(pathCandidate)) return pathCandidate;
  }
  return null;
}

async function validateBrowserBundle(root, bundleRoot) {
  if (!await exists(bundleRoot)) contractError(`browser bundle is missing: ${path.relative(root, bundleRoot)}`);
  const files = (await listFiles(bundleRoot)).filter(file => !file.endsWith(".map"));
  if (files.length === 0) contractError(`browser bundle is empty: ${path.relative(root, bundleRoot)}`);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const label = path.relative(root, file);
    assertNoSecrets(source, label);
    for (const pattern of PG_BUNDLE_PATTERNS) {
      if (pattern.test(source)) leakError(`${label} contains pg client bundle material`);
    }
  }
  return files.length;
}

function assertNoSecrets(source, label) {
  for (const forbidden of SECRET_PATTERNS) {
    if (forbidden.pattern.test(source)) leakError(`${label} contains ${forbidden.label}`);
  }
}

async function readRequiredSource(root, relativePath) {
  const resolved = within(root, relativePath);
  if (!await isFile(resolved)) contractError(`required source is missing: ${relativePath}`);
  return readFile(resolved, "utf8");
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(resolved));
    else if (entry.isFile()) result.push(resolved);
  }
  return result;
}

async function exists(filePath) {
  try { await stat(filePath); return true; } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function isFile(filePath) {
  try { return (await stat(filePath)).isFile(); } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function within(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (!withinRoot(root, resolved)) contractError(`path escapes validation root: ${relativePath}`);
  return resolved;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function contractError(message) {
  const error = new Error(message);
  error.code = "CANONICAL_APPLICATION_CONTRACT_DRIFT";
  throw error;
}

function leakError(message) {
  const error = new Error(message);
  error.code = "CANONICAL_BROWSER_SECRET_LEAK";
  throw error;
}

async function cli() {
  const result = await validateCanonicalFinalArtifacts({ root: process.cwd() });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const invoked = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  cli().catch(error => {
    process.stderr.write(`${error.code ?? "CANONICAL_FINAL_ARTIFACT_ERROR"}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
