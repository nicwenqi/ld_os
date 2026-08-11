import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("Better Auth is server-only, uses only AUTH_DATABASE_URL, and creates UUID identity IDs", async () => {
  const source = await read("../app/lib/auth/better-auth.ts");

  assert.match(source, /import\s+["']server-only["']/);
  assert.match(source, /from\s+["']better-auth["']/);
  assert.match(source, /AUTH_DATABASE_URL/);
  assert.match(source, /BETTER_AUTH_SECRET/);
  assert.match(source, /generateId:\s*["']uuid["']/);
  assert.match(source, /modelName:\s*["']auth_user["']/);
  assert.match(source, /modelName:\s*["']auth_session["']/);
  assert.doesNotMatch(source, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(source, /supabase/i);
});

test("the Better Auth schema names are isolated from Neon business authorization tables", async () => {
  const source = await read("../app/lib/auth/better-auth.ts");
  for (const name of ["auth_user", "auth_session", "auth_account", "auth_verification"]) {
    assert.match(source, new RegExp(`modelName:\\s*["']${name}["']`));
  }
  assert.doesNotMatch(source, /user_accounts|property_memberships|role_assignments|trainer_scopes/);
});

test("Better Auth is mounted only behind the same-origin auth route", async () => {
  const source = await read("../app/api/auth/[...all]/route.ts");
  assert.match(source, /getBetterAuth\(\)\.handler/);
  assert.match(source, /export const GET/);
  assert.match(source, /export const POST/);
  assert.doesNotMatch(source, /supabase|AUTH_DATABASE_URL|BETTER_AUTH_SECRET/i);
});
