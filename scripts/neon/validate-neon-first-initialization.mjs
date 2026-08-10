#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const FORBIDDEN = [
  /\bset\s+(?:local\s+)?role\b/i,
  /@supabase\/supabase-js|createClient\s*\(/i,
  /\bauth\.users\b/i,
  /\bgrant\b[\s\S]{0,240}\bhotel_ld_application\b/i,
  /from\s+["'][^"']*app\/api\//i,
  /from\s+["'][^"']*app\/repositories\//i,
  /stage_employee_import|legacy import|supabase storage/i,
];

export function validateNeonFirstInitializationSource(sources) {
  if (!sources || typeof sources !== "object") return false;
  for (const key of ["contract", "operator", "cli"]) {
    if (typeof sources[key] !== "string" || sources[key].length === 0) return false;
    if (FORBIDDEN.some((pattern) => pattern.test(sources[key]))) return false;
  }
  return true;
}

async function loadSources() {
  const directory = resolve(fileURLToPath(new URL(".", import.meta.url)));
  const [contract, operator, cli] = await Promise.all([
    readFile(resolve(directory, "neon-first-initialization-contract.mjs"), "utf8"),
    readFile(resolve(directory, "neon-first-initialization-operator.mjs"), "utf8"),
    readFile(resolve(directory, "initialize-neon-first-environment.mjs"), "utf8"),
  ]);
  return { contract, operator, cli };
}

async function main() {
  if (process.argv[2] !== "source" || process.argv.length !== 3) throw Object.assign(new Error("NEON_FIRST_INIT_SOURCE_COMMAND_REQUIRED"), { code: "NEON_FIRST_INIT_SOURCE_COMMAND_REQUIRED" });
  if (!validateNeonFirstInitializationSource(await loadSources())) throw Object.assign(new Error("NEON_FIRST_INIT_SOURCE_BOUNDARY_INVALID"), { code: "NEON_FIRST_INIT_SOURCE_BOUNDARY_INVALID" });
  process.stdout.write(`${JSON.stringify({ source: "validated", runtimePath: "excluded", authProvider: "adapter-only", applicationRawPrivilege: "zero" })}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || "NEON_FIRST_INIT_SOURCE_FAILED"}\n`);
    process.exitCode = 1;
  });
}
