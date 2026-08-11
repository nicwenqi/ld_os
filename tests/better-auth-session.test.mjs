import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

async function sessionService(t) {
  const directory = await mkdtemp(join(tmpdir(), "better-auth-session-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = new URL("../app/services/better-auth-session.ts", import.meta.url);
  const source = (await readFile(sourcePath, "utf8")).replace('import "server-only";\n\n', "");
  const target = join(directory, "better-auth-session.ts");
  await writeFile(target, source);
  return import(`${pathToFileURL(target).href}?test=${Date.now()}`);
}

test("same-origin Better Auth login derives its technical email server-side and returns only a verified UUID subject", async t => {
  const service = await sessionService(t);
  const result = await service.signInWithBetterAuth({
    request: new Request("https://hotel.example.test/api/auth/login", { headers: { origin: "https://hotel.example.test" } }),
    loginId: "property-manager",
    password: "HotelDemo2026",
    hostname: "hotel.example.test",
    deriveAuthEmail: (loginId, hostname) => `${loginId}@${hostname}`,
    handler: async request => {
      assert.equal(new URL(request.url).pathname, "/api/auth/sign-in/email");
      assert.deepEqual(await request.json(), { email: "property-manager@hotel.example.test", password: "HotelDemo2026", rememberMe: true });
      return Response.json({ user: { id: "11111111-1111-4111-8111-111111111111" } }, { headers: { "set-cookie": "better-auth.session_token=opaque; HttpOnly" } });
    },
  });
  assert.equal(result.userId, "11111111-1111-4111-8111-111111111111");
  assert.equal(result.refreshedCookies.length, 1);
});

test("Better Auth identity resolution accepts only a session subject returned by its same-origin handler", async t => {
  const service = await sessionService(t);
  const identity = await service.resolveBetterAuthIdentityWith({
    request: new Request("https://hotel.example.test/api/people"),
    handler: async request => {
      assert.equal(new URL(request.url).pathname, "/api/auth/get-session");
      return Response.json({ user: { id: "11111111-1111-4111-8111-111111111111" } });
    },
  });
  assert.deepEqual(identity, { userId: "11111111-1111-4111-8111-111111111111", refreshedCookies: [] });
});

test("Better Auth identity resolution fails closed for an invalid provider subject", async t => {
  const service = await sessionService(t);
  const identity = await service.resolveBetterAuthIdentityWith({
    request: new Request("https://hotel.example.test/api/people"),
    handler: async () => Response.json({ user: { id: "not-a-uuid" } }),
  });
  assert.equal(identity, null);
});

test("active request authentication resolves Better Auth sessions before Neon authorization", async () => {
  const source = await readFile(new URL("../app/services/request-authentication.ts", import.meta.url), "utf8");
  assert.match(source, /resolveBetterAuthIdentity/);
  assert.doesNotMatch(source, /supabase|createServerPasswordClient|refreshSession/);
});
