import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateCanonicalNeonSource } from "./validate-canonical-neon-baseline.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../app/repositories/neon");
const neonLibRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../app/lib/neon");
const canonicalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../neon/canonical");

const requiredAuditSurface = {
  tables: [
    "app_private.employee_write_audit_events",
    "app_private.organization_alias_activation_audit_events",
    "app_private.organization_alias_resolution_audit_events",
    "app_private.organization_operational_unit_audit_events",
    "app_private.organization_read_audit_events",
    "app_private.organization_write_audit_events",
    "app_private.people_read_audit_events",
    "app_private.position_mapping_audit_events",
    "app_private.position_read_audit_events",
    "app_private.position_write_audit_events",
  ],
  routines: [
    "app_private.append_neon_employee_write_audit",
    "app_private.append_neon_organization_alias_activation_audit",
    "app_private.append_neon_organization_read_audit",
    "app_private.append_neon_organization_write_audit",
    "app_private.append_neon_people_read_audit",
    "app_private.append_neon_position_read_audit",
    "app_private.append_neon_position_write_audit",
    "app_private.reject_employee_write_audit_mutation",
    "app_private.reject_organization_alias_activation_audit_mutation",
    "app_private.reject_organization_alias_audit_mutation",
    "app_private.reject_organization_operational_unit_audit_mutation",
    "app_private.reject_organization_read_audit_mutation",
    "app_private.reject_organization_write_audit_mutation",
    "app_private.reject_people_read_audit_mutation",
    "app_private.reject_position_mapping_audit_mutation",
    "app_private.reject_position_read_audit_mutation",
    "app_private.reject_position_write_audit_mutation",
  ],
  triggers: [
    "e4_position_write_audit_append_only",
    "e4c_position_mapping_audit_append_only",
    "e5a_employee_write_audit_append_only",
    "organization_alias_activation_audit_append_only",
    "organization_alias_resolution_audit_append_only",
    "organization_operational_unit_audit_append_only",
    "organization_read_audit_append_only",
    "organization_write_audit_append_only",
    "people_read_audit_append_only",
    "position_read_audit_append_only",
  ],
};

async function isolatedActorContext(t) {
  const root = await mkdtemp(join(tmpdir(), "canonical-actor-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = join(root, "actor-context.ts");
  const source = (await readFile(join(neonLibRoot, "actor-context.ts"), "utf8"))
    .replace(
      'import { createNeonPool } from "./server.ts";',
      'const createNeonPool = () => { throw new Error("test pool required"); };',
    );
  await writeFile(target, source);
  return import(`${pathToFileURL(target).href}?test=${Date.now()}`);
}

function actorClient() {
  const statements = [];
  const releases = [];
  let transactionOpen = false;
  let contextSet = false;
  const client = {
    async query(statement) {
      const sql = typeof statement === "string" ? statement : statement.text;
      statements.push(sql);
      if (sql.includes("as contaminated")) return { rows: [{ contaminated: contextSet }] };
      if (sql.startsWith("BEGIN")) { transactionOpen = true; return { rows: [] }; }
      if (sql.includes("as authorized")) return { rows: [{ authorized: true }] };
      if (sql.includes("set_config")) { contextSet = true; return { rows: [{}] }; }
      if (sql.includes("as matches")) return { rows: [{ matches: contextSet }] };
      if (sql === "COMMIT" || sql === "ROLLBACK") {
        assert.equal(transactionOpen, true);
        transactionOpen = false;
        contextSet = false;
      }
      return { rows: [] };
    },
    release(error) { releases.push(error); },
  };
  return { client, statements, releases };
}

test("the ordered canonical modules form a complete connection-free source baseline", async () => {
  const result = await validateCanonicalNeonSource({ root: canonicalRoot });

  assert.deepEqual(result.modules, [
    "010_roles.sql",
    "020_actor_context.sql",
    "030_people.sql",
    "040_organization.sql",
    "050_position.sql",
    "060_employee_write.sql",
    "070_security_postflight.sql",
  ]);
});

test("the canonical manifest retains final append-only E2-E5A audit capability", async () => {
  const manifest = JSON.parse(await readFile(join(canonicalRoot, "manifest.json"), "utf8"));

  for (const [kind, expected] of Object.entries(requiredAuditSurface)) {
    const actual = new Set(manifest[kind]);
    assert.deepEqual(expected.filter((name) => !actual.has(name)), [], `missing ${kind}`);
  }
  assert.equal(manifest.exclusions.objects.includes("audit_events"), false);
});

test("repository query signatures exactly match the canonical manifest", async () => {
  const manifest = JSON.parse(await readFile(join(canonicalRoot, "manifest.json"), "utf8"));
  const sources = [
    ...(await readdir(repositoryRoot)).filter((name) => name.endsWith("-repository.ts")).map((name) => join(repositoryRoot, name)),
    join(neonLibRoot, "organization-property.ts"),
    join(neonLibRoot, "people-property.ts"),
  ];
  const signatures = new Set();

  for (const file of sources) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/public\.([a-z0-9_]+)\s*\(([^)]*)\)/gis)) {
      const parameters = [...match[2].matchAll(/\$\d+::([a-z0-9_]+(?:\[\])?)/gi)].map((item) => item[1].toLowerCase());
      if (parameters.length > 0) signatures.add(`public.${match[1].toLowerCase()}(${parameters.join(",")})`);
    }
  }

  assert.deepEqual([...signatures].sort(), [...manifest.entrypointSignatures].sort());
});

test("runtime actor checks require only the canonical roles and schemas", async () => {
  const forbiddenCompatibilityChecks = [
    "current_database() = 'neondb'",
    "hotel_ld_people_read",
    "authenticated",
    "namespace.nspname in ('public', 'auth', 'app_private')",
  ];
  const source = await readFile(resolve(canonicalRoot, "../../app/lib/neon/actor-context.ts"), "utf8");
  for (const forbidden of forbiddenCompatibilityChecks) {
    assert.equal(source.includes(forbidden), false, `legacy runtime dependency: ${forbidden}`);
  }
});

test("actor context remains transaction-local through set, commit, and connection release", async (t) => {
  const { withNeonActorContext } = await isolatedActorContext(t);
  const state = actorClient();
  const pool = { async connect() { return state.client; } };

  const result = await withNeonActorContext(
    { authUserId: "00000000-0000-0000-0000-000000000001", propertyId: "00000000-0000-0000-0000-000000000002", requestId: "00000000-0000-0000-0000-000000000003" },
    async () => "committed",
    pool,
  );

  assert.equal(result, "committed");
  assert.equal(state.statements.filter((sql) => sql.includes("as contaminated")).length, 2);
  assert.equal(state.statements.includes("COMMIT"), true);
  assert.deepEqual(state.releases, [undefined]);
});

test("actor context rolls back cleanly and the checked client can be reused", async (t) => {
  const { withNeonActorContext } = await isolatedActorContext(t);
  const state = actorClient();
  const pool = { async connect() { return state.client; } };
  const input = { authUserId: "00000000-0000-0000-0000-000000000001", propertyId: "00000000-0000-0000-0000-000000000002", requestId: "00000000-0000-0000-0000-000000000003" };

  await assert.rejects(withNeonActorContext(input, async () => { throw new Error("action failed"); }, pool), /action failed/);
  const reused = await withNeonActorContext(input, async () => "reused", pool);

  assert.equal(reused, "reused");
  assert.equal(state.statements.includes("ROLLBACK"), true);
  assert.equal(state.statements.at(-2), "COMMIT");
  assert.deepEqual(state.releases, [undefined, undefined]);
});
