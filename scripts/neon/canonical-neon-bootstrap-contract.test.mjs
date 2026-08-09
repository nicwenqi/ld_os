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

async function canonicalSql(name) {
  return (await readFile(join(canonicalRoot, name), "utf8"))
    .replace(/\s+/g, " ")
    .replace(/\s*([(),=])\s*/g, "$1")
    .toLowerCase();
}

function routineSource(source, qualifiedName) {
  const marker = `create function ${qualifiedName.toLowerCase()}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const next = source.indexOf(" create function ", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

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

test("every relationship carrying tenant and property scope uses a composite foreign key", async () => {
  const source = `${await canonicalSql("030_people.sql")} ${await canonicalSql("040_organization.sql")} ${await canonicalSql("050_position.sql")} ${await canonicalSql("060_employee_write.sql")}`;
  const required = [
    "foreign key(tenant_id,property_id,role_id)references public.roles(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,role_assignment_id)references public.role_assignments(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,parent_id)references public.departments(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,target_department_id)references public.departments(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,parent_operational_unit_id)references public.operational_units(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,position_family_id)references public.position_families(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,position_id)references public.positions(tenant_id,property_id,id)",
    "foreign key(tenant_id,property_id,employee_id)references public.employees(tenant_id,property_id,id)",
  ];
  for (const contract of required) assert.equal(source.includes(contract), true, contract);
});

test("employee save locks deterministically and validates every authoritative target", async () => {
  const source = routineSource(await canonicalSql("060_employee_write.sql"), "public.save_neon_employee_with_identifiers");
  const guards = [
    "pg_advisory_xact_lock",
    "order by identifier.source_system,identifier.identifier_type,identifier.identifier_value,identifier.id for update",
    "for key share",
    "position.position_family_id",
    "position_department_assignments",
    "active_targets_required",
    "identifier_count > 100",
    "identifier_conflict",
    "v_authoritative_family_id",
  ];
  for (const guard of guards) assert.equal(source.includes(guard), true, guard);
});

test("department rename and nullable-root moves rebuild the complete authoritative subtree", async () => {
  const source = await canonicalSql("040_organization.sql");
  const update = routineSource(source, "public.update_neon_organization_department");
  const preview = routineSource(source, "public.preview_neon_organization_department_move");
  const move = routineSource(source, "public.move_neon_organization_department");
  assert.equal(update.includes("with recursive"), true);
  assert.equal(update.includes("path_names_zh"), true);
  assert.equal(update.includes("path_names_en"), true);
  assert.equal(preview.includes("if p_parent is not null"), true);
  assert.equal(preview.includes("ancestor_department_id=d.id"), true);
  assert.equal(move.includes("p_parent is null"), true);
  assert.equal(move.includes("path_names_zh"), true);
  assert.equal(move.includes("path_names_en"), true);
});

test("operational-unit parent changes reject cycles and rebuild descendant paths", async () => {
  const source = routineSource(await canonicalSql("040_organization.sql"), "public.update_neon_organization_operational_unit");
  assert.equal(source.includes("p_parent=p_id"), true);
  assert.equal(source.includes("with recursive"), true);
  assert.equal(source.includes("operational_unit_cycle"), true);
  assert.equal(source.includes("path_ids"), true);
  assert.equal(source.includes("depth"), true);
});

test("alias resolution accepts only active same-scope targets and coherent actions", async () => {
  const organization = await canonicalSql("040_organization.sql");
  const position = routineSource(await canonicalSql("050_position.sql"), "public.resolve_neon_position_alias");
  for (const name of [
    "public.resolve_neon_organization_department_alias",
    "public.merge_neon_organization_department_alias",
    "public.resolve_neon_organization_department_alias_to_operational_unit",
  ]) {
    const routine = routineSource(organization, name);
    assert.equal(routine.includes("tenant_id"), true, name);
    assert.equal(routine.includes("is_active"), true, name);
  }
  assert.equal(position.includes("position.position_family_id"), true);
  assert.equal(position.includes("target_position_family_id"), true);
  assert.equal(position.includes("external_role_code_required"), true);
  assert.equal(position.includes("external_role_name_required"), true);
  assert.equal(position.includes("is_active"), true);
});

test("authorization RLS limits tenant, profile, membership, and global-role rows to the actor", async () => {
  const source = await canonicalSql("070_security_postflight.sql");
  const peopleResolver = routineSource(await canonicalSql("030_people.sql"), "public.resolve_neon_people_property");
  const organizationResolver = routineSource(await canonicalSql("040_organization.sql"), "public.resolve_neon_organization_property");
  const tenantPolicy = source.slice(source.indexOf("create policy canonical_tenant_scope on public.tenants"), source.indexOf("create policy canonical_tenant_scope on public.properties"));
  const profilePolicy = source.slice(source.indexOf("create policy canonical_actor_context_scope on public.profiles"), source.indexOf("create policy canonical_tenant_scope on public.user_accounts"));
  const membershipPolicy = source.slice(source.indexOf("create policy canonical_tenant_scope on public.tenant_memberships"), source.indexOf("create policy canonical_tenant_scope on public.property_memberships"));
  const rolePolicy = source.slice(source.indexOf("create policy canonical_tenant_scope on public.roles"), source.indexOf("create policy canonical_tenant_scope on public.role_assignments"));
  assert.equal(tenantPolicy.includes("select tenant_id from public.properties"), true);
  assert.equal(profilePolicy.includes("select user_id from public.user_accounts"), true);
  assert.equal(membershipPolicy.includes("user_id=app_private.current_neon_organization_actor_user_id()"), true);
  assert.equal(rolePolicy.includes("tenant_id=(select tenant_id from public.properties"), true);
  assert.equal(peopleResolver.includes("join public.tenants"), false);
  assert.equal(organizationResolver.includes("join public.tenants"), false);
});

test("hostname evidence is canonicalized case-insensitively and ignores a request port", async () => {
  const people = await canonicalSql("030_people.sql");
  assert.equal(people.includes("unique index canonical_property_domain_hostname on public.property_domains(pg_catalog.lower(hostname))"), true);
  const resolver = routineSource(people, "public.resolve_neon_people_property");
  const matcher = routineSource(people, "app_private.neon_people_hostname_matches");
  for (const routine of [resolver, matcher]) {
    assert.equal(routine.includes("split_part(pg_catalog.btrim(coalesce(p_hostname,'')),':',1)"), true);
    assert.equal(routine.includes("pg_catalog.lower"), true);
  }
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
