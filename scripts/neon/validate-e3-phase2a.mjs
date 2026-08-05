import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import pg from "pg";

const DEVELOPMENT_ENDPOINT = "ep-sparkling-shape-az9gxtuh";
const PRODUCTION_ENDPOINT = "ep-wild-wave-azjmgdif";
const DATABASE = "neondb";
const BOOTSTRAP_ROLE = "neondb_owner";
const RUNTIME_ROLE = "hotel_ld_application";

export function assertApprovedBootstrapUrl(raw) {
  return approvedConnection(raw, {
    role: BOOTSTRAP_ROLE,
    pooled: false,
    roleError: "E3_PHASE2A_BOOTSTRAP_ROLE_DENIED",
  });
}

export function assertApprovedRuntimeUrl(raw) {
  return approvedConnection(raw, {
    role: RUNTIME_ROLE,
    pooled: true,
    roleError: "E3_PHASE2A_RUNTIME_ROLE_DENIED",
  });
}

async function main() {
  const command = process.argv[2];
  if (command !== "catalog" && command !== "runtime") {
    throw new Error("E3_PHASE2A_VALIDATION_COMMAND_REQUIRED");
  }

  const environment = await loadLocalEnvironment();
  const bootstrapUrl = required(environment, "NEON_BOOTSTRAP_DATABASE_URL");
  const runtimeUrl = required(environment, "DATABASE_URL");
  const bootstrap = assertApprovedBootstrapUrl(bootstrapUrl);
  const runtime = assertApprovedRuntimeUrl(runtimeUrl);

  if (command === "catalog") {
    const evidence = await validateCatalog(bootstrapUrl);
    console.log(JSON.stringify({
      command,
      bootstrap,
      runtime,
      assertions: evidence,
    }));
    return;
  }

  const evidence = await validateRuntime(bootstrapUrl, runtimeUrl);
  console.log(JSON.stringify({
    command,
    bootstrap,
    runtime,
    assertions: evidence,
  }));
}

function approvedConnection(raw, expected) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E3_PHASE2A_DATABASE_URL_INVALID");
  }

  const hostname = url.hostname.toLowerCase();
  const role = decodeURIComponent(url.username);
  const database = url.pathname.replace(/^\//, "");
  const pooled = hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`);

  if (
    hostname.startsWith(`${PRODUCTION_ENDPOINT}.`) ||
    hostname.startsWith(`${PRODUCTION_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE2A_PRODUCTION_ENDPOINT_DENIED");
  }
  if (
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}.`) &&
    !hostname.startsWith(`${DEVELOPMENT_ENDPOINT}-pooler.`)
  ) {
    throw new Error("E3_PHASE2A_CHILD_ENDPOINT_REQUIRED");
  }
  if (database !== DATABASE) {
    throw new Error("E3_PHASE2A_DATABASE_DENIED");
  }
  if (role !== expected.role) {
    throw new Error(expected.roleError);
  }
  if (pooled !== expected.pooled) {
    throw new Error(
      expected.pooled
        ? "E3_PHASE2A_POOLED_RUNTIME_REQUIRED"
        : "E3_PHASE2A_DIRECT_BOOTSTRAP_REQUIRED",
    );
  }

  return { endpoint: DEVELOPMENT_ENDPOINT, database, role, pooled };
}

async function validateCatalog(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    const identity = await client.query(`
      select current_database() as database,
             current_user as current_user,
             session_user as session_user
    `);
    const row = identity.rows[0];
    if (
      row?.database !== DATABASE ||
      row.current_user !== BOOTSTRAP_ROLE ||
      row.session_user !== BOOTSTRAP_ROLE
    ) {
      throw new Error("E3_PHASE2A_BOOTSTRAP_IDENTITY_MISMATCH");
    }

    const target = await client.query(`
      select
        pg_catalog.to_regprocedure(
          'public.create_neon_organization_department(text,uuid,uuid,uuid,text,text,text,text,integer)'
        ) is not null as create_exists,
        pg_catalog.to_regprocedure(
          'public.update_neon_organization_department(text,uuid,bigint,text,text,integer,boolean)'
        ) is not null as update_exists,
        pg_catalog.to_regclass(
          'app_private.organization_write_audit_events'
        ) is not null as audit_exists
    `);
    if (
      target.rows[0]?.create_exists !== true ||
      target.rows[0]?.update_exists !== true ||
      target.rows[0]?.audit_exists !== true
    ) {
      throw new Error("E3_PHASE2A_OBJECT_MISSING");
    }

    const functions = await client.query(`
      select namespace.nspname,
             routine.proname,
             owner_role.rolname as owner,
             routine.prosecdef,
             routine.proconfig,
             pg_catalog.has_function_privilege(
               'hotel_ld_application', routine.oid, 'EXECUTE'
             ) as application_execute,
             exists (
               select 1
               from pg_catalog.aclexplode(
                 coalesce(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) acl
               where acl.grantee = 0
                 and acl.privilege_type = 'EXECUTE'
             ) as public_execute
      from pg_catalog.pg_proc routine
      join pg_catalog.pg_namespace namespace
        on namespace.oid = routine.pronamespace
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = routine.proowner
      where (
        namespace.nspname = 'public'
        and routine.proname in (
          'create_neon_organization_department',
          'update_neon_organization_department',
          'create_department',
          'update_department_details'
        )
      ) or (
        namespace.nspname = 'app_private'
        and routine.proname in (
          'prepare_department_insert',
          'insert_department_closure'
        )
      )
    `);
    const byName = new Map(
      functions.rows.map(functionRow => [
        `${functionRow.nspname}.${functionRow.proname}`,
        functionRow,
      ]),
    );
    for (const name of [
      "public.create_neon_organization_department",
      "public.update_neon_organization_department",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.owner !== "hotel_ld_migration_owner" ||
        functionRow.prosecdef !== true ||
        functionRow.application_execute !== true ||
        functionRow.public_execute !== false ||
        !functionRow.proconfig?.includes('search_path=""')
      ) {
        throw new Error("E3_PHASE2A_ENTRYPOINT_DRIFT");
      }
    }
    for (const name of [
      "app_private.prepare_department_insert",
      "app_private.insert_department_closure",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.owner !== "hotel_ld_migration_owner" ||
        functionRow.prosecdef !== false ||
        functionRow.public_execute !== false ||
        !functionRow.proconfig?.includes('search_path=""')
      ) {
        throw new Error("E3_PHASE2A_TRIGGER_HELPER_DRIFT");
      }
    }
    for (const name of [
      "public.create_department",
      "public.update_department_details",
    ]) {
      const functionRow = byName.get(name);
      if (
        !functionRow ||
        functionRow.public_execute !== false ||
        functionRow.application_execute !== false
      ) {
        throw new Error("E3_PHASE2A_LEGACY_EXECUTE_DRIFT");
      }
    }

    const relationSecurity = await client.query(`
      select relation.relname,
             relation.relrowsecurity,
             relation.relforcerowsecurity,
             pg_catalog.has_table_privilege(
               'hotel_ld_application', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as application_table_privilege,
             pg_catalog.has_any_column_privilege(
               'hotel_ld_application', relation.oid,
               'SELECT,INSERT,UPDATE,REFERENCES'
             ) as application_column_privilege,
             pg_catalog.has_table_privilege(
               'hotel_ld_people_read', relation.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
             ) as people_table_privilege,
             pg_catalog.has_any_column_privilege(
               'hotel_ld_people_read', relation.oid,
               'SELECT,INSERT,UPDATE,REFERENCES'
             ) as people_column_privilege
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname in ('departments', 'department_closure')
    `);
    if (
      relationSecurity.rows.length !== 2 ||
      relationSecurity.rows.some(relation =>
        !relation.relrowsecurity ||
        !relation.relforcerowsecurity ||
        relation.application_table_privilege ||
        relation.application_column_privilege ||
        relation.people_table_privilege ||
        relation.people_column_privilege
      )
    ) {
      throw new Error("E3_PHASE2A_RAW_PRIVILEGE_OR_RLS_DRIFT");
    }

    const closureAuthority = await client.query(`
      select
        pg_catalog.has_table_privilege(
          'hotel_ld_migration_owner',
          'public.department_closure',
          'UPDATE,DELETE'
        ) as table_mutation,
        pg_catalog.has_any_column_privilege(
          'hotel_ld_migration_owner',
          'public.department_closure',
          'UPDATE'
        ) as column_update
    `);
    if (
      closureAuthority.rows[0]?.table_mutation !== false ||
      closureAuthority.rows[0]?.column_update !== false
    ) {
      throw new Error("E3_PHASE2A_CLOSURE_REWRITE_AUTHORITY_DRIFT");
    }

    const policyCount = await client.query(`
      select count(*)::integer as count
      from pg_catalog.pg_policies
      where schemaname in ('public', 'app_private')
        and policyname in (
          'e3_phase2a_departments_insert',
          'e3_phase2a_departments_update',
          'e3_phase2a_department_closure_insert',
          'e3_phase2a_position_assignments_blocker_read',
          'e3_phase2a_organization_write_audit_insert'
        )
    `);
    if (policyCount.rows[0]?.count !== 5) {
      throw new Error("E3_PHASE2A_POLICY_INVENTORY_DRIFT");
    }

    await client.query("rollback");
    return {
      targetObjects: 3,
      constrainedEntrypoints: 2,
      constrainedTriggerHelpers: 2,
      protectedRelations: 2,
      writePolicies: 5,
      rawRuntimePrivileges: 0,
      closureRewritePrivileges: 0,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Connection teardown below is the remaining safe action.
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function validateRuntime(bootstrapUrl, runtimeUrl) {
  const fixture = await createValidationFixture(bootstrapUrl);
  let root;
  let child;
  try {
    const rootRequestId = randomUUID();
    root = await runActorTransaction(
      runtimeUrl,
      actor(fixture.managerAuthUserId, fixture.propertyId, rootRequestId),
      client => createDepartment(client, fixture, {
        parentId: null,
        code: `${fixture.codePrefix}-root`,
        nameZh: "E3 Phase 2A 验证根部门",
        nameEn: "E3 Phase 2A Validation Root",
        sortOrder: 900_000,
      }),
      true,
    );
    assertDepartmentNode(root, {
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      parentId: null,
      depth: 0,
      pathIds: [root.id],
      version: 1,
      isActive: true,
    });

    const childRequestId = randomUUID();
    child = await runActorTransaction(
      runtimeUrl,
      actor(fixture.managerAuthUserId, fixture.propertyId, childRequestId),
      client => createDepartment(client, fixture, {
        parentId: root.id,
        code: `${fixture.codePrefix}-child`,
        nameZh: "E3 Phase 2A 验证子部门",
        nameEn: "E3 Phase 2A Validation Child",
        sortOrder: 900_010,
      }),
      true,
    );
    assertDepartmentNode(child, {
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      parentId: root.id,
      depth: 1,
      pathIds: [root.id, child.id],
      version: 1,
      isActive: true,
    });

    await addDepartmentAdminScope(bootstrapUrl, fixture, root.id);
    await assertHierarchyEvidence(bootstrapUrl, fixture, root.id, child.id);

    const updateRequestId = randomUUID();
    root = await runActorTransaction(
      runtimeUrl,
      actor(fixture.managerAuthUserId, fixture.propertyId, updateRequestId),
      client => updateDepartment(client, fixture, {
        id: root.id,
        expectedVersion: 1,
        nameZh: "E3 Phase 2A 验证根部门（已更新）",
        nameEn: "E3 Phase 2A Validation Root Updated",
        sortOrder: 900_001,
        isActive: true,
      }),
      true,
    );
    assertDepartmentNode(root, {
      tenantId: fixture.tenantId,
      propertyId: fixture.propertyId,
      parentId: null,
      depth: 0,
      pathIds: [root.id],
      version: 2,
      isActive: true,
    });

    child = await runActorTransaction(
      runtimeUrl,
      actor(fixture.managerAuthUserId, fixture.propertyId, randomUUID()),
      client => updateDepartment(client, fixture, {
        id: child.id,
        expectedVersion: 1,
        nameZh: "E3 Phase 2A 验证子部门",
        nameEn: "E3 Phase 2A Validation Child",
        sortOrder: 900_010,
        isActive: false,
      }),
      true,
    );
    if (child.version !== 2 || child.is_active !== false) {
      throw new Error("E3_PHASE2A_ACTIVE_STATE_UPDATE_FAILED");
    }

    await expectDatabaseError(
      () => runActorTransaction(
        runtimeUrl,
        actor(fixture.adminAuthUserId, fixture.propertyId, randomUUID()),
        client => createDepartment(client, fixture, {
          parentId: root.id,
          code: `${fixture.codePrefix}-admin-denied`,
          nameZh: "不应创建的部门",
          nameEn: "Denied Department",
          sortOrder: 900_020,
        }),
        false,
      ),
      "42501",
      "NEON_ORGANIZATION_MANAGER_FORBIDDEN",
    );

    await expectDatabaseError(
      () => runActorTransaction(
        runtimeUrl,
        actor(fixture.managerAuthUserId, fixture.propertyId, randomUUID()),
        client => client.query(
          `
            select public.create_neon_organization_department(
              $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,
              $6::text,$7::text,$8::text,$9::integer
            ) as payload
          `,
          [
            fixture.hostname,
            randomUUID(),
            randomUUID(),
            null,
            "department",
            `${fixture.codePrefix}-cross-property`,
            "不应跨酒店创建",
            "Denied Cross Property",
            900_030,
          ],
        ),
        false,
      ),
      "42501",
      "NEON_ORGANIZATION_PROPERTY_FORBIDDEN",
    );

    const staleRequestId = randomUUID();
    await expectDatabaseError(
      () => runActorTransaction(
        runtimeUrl,
        actor(fixture.managerAuthUserId, fixture.propertyId, staleRequestId),
        client => updateDepartment(client, fixture, {
          id: root.id,
          expectedVersion: 1,
          nameZh: "不应覆盖的新名称",
          nameEn: "Denied Stale Update",
          sortOrder: 1,
          isActive: true,
        }),
        false,
      ),
      "P2002",
      "NEON_ORGANIZATION_DEPARTMENT_STALE_VERSION",
    );

    await expectDatabaseError(
      () => runActorTransaction(
        runtimeUrl,
        actor(fixture.managerAuthUserId, fixture.propertyId, randomUUID()),
        client => updateDepartment(client, fixture, {
          id: root.id,
          expectedVersion: 2,
          nameZh: root.name_zh,
          nameEn: root.name_en ?? "",
          sortOrder: root.sort_order,
          isActive: false,
        }),
        false,
      ),
      "P5402",
      "NEON_ORGANIZATION_DEPARTMENT_ACTIVE_SCOPES",
    );

    const rollbackRequestId = randomUUID();
    const rolledBack = await runActorTransaction(
      runtimeUrl,
      actor(
        fixture.managerAuthUserId,
        fixture.propertyId,
        rollbackRequestId,
      ),
      client => createDepartment(client, fixture, {
        parentId: root.id,
        code: `${fixture.codePrefix}-rolled-back`,
        nameZh: "应回滚的部门",
        nameEn: "Rolled Back Department",
        sortOrder: 900_040,
      }),
      false,
    );
    await assertRollbackEvidence(
      bootstrapUrl,
      rollbackRequestId,
      rolledBack.id,
    );

    await Promise.all([
      runActorTransaction(
        runtimeUrl,
        actor(fixture.managerAuthUserId, fixture.propertyId, randomUUID()),
        client => createDepartment(client, fixture, {
          parentId: root.id,
          code: `${fixture.codePrefix}-concurrent-manager`,
          nameZh: "并发经理回滚部门",
          nameEn: "Concurrent Manager Rollback",
          sortOrder: 900_050,
        }),
        false,
      ),
      expectDatabaseError(
        () => runActorTransaction(
          runtimeUrl,
          actor(fixture.adminAuthUserId, fixture.propertyId, randomUUID()),
          client => createDepartment(client, fixture, {
            parentId: root.id,
            code: `${fixture.codePrefix}-concurrent-admin`,
            nameZh: "并发管理员拒绝部门",
            nameEn: "Concurrent Admin Denied",
            sortOrder: 900_060,
          }),
          false,
        ),
        "42501",
        "NEON_ORGANIZATION_MANAGER_FORBIDDEN",
      ),
    ]);

    await assertRawRuntimeAccessDenied(runtimeUrl);
    await assertAuditEvidence(bootstrapUrl, fixture, {
      rootId: root.id,
      rootRequestId,
      updateRequestId,
      staleRequestId,
    });

    return {
      managerCreateRoot: "PASS",
      managerCreateChild: "PASS",
      hierarchyClosure: "PASS",
      managerDetailUpdate: "PASS",
      managerActiveStateUpdate: "PASS",
      departmentAdminDenied: "PASS",
      crossPropertyDenied: "PASS",
      staleVersionConflict: "PASS",
      activeScopeBlocker: "PASS",
      auditCorrectness: "PASS",
      rollbackSafety: "PASS",
      contextClearedAfterTransaction: "PASS",
      concurrentActorIsolation: "PASS",
      directRuntimeTableAccessDenied: "PASS",
    };
  } finally {
    await cleanupValidationFixture(bootstrapUrl, fixture, {
      rootId: root?.id ?? null,
      childId: child?.id ?? null,
    });
  }
}

async function createValidationFixture(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const fixture = {
    codePrefix: `e3-phase2a-${suffix}`,
    managerProfileUserId: randomUUID(),
    managerAuthUserId: randomUUID(),
    adminProfileUserId: randomUUID(),
    adminAuthUserId: randomUUID(),
    managerAssignmentId: randomUUID(),
    adminAssignmentId: randomUUID(),
  };
  try {
    await client.query("begin");
    const target = await client.query(`
      select property.tenant_id,
             property.id as property_id,
             domain.hostname,
             manager_role.id as manager_role_id,
             admin_role.id as admin_role_id
      from public.properties property
      join public.tenants tenant
        on tenant.id = property.tenant_id
       and tenant.status::text = 'active'
      join public.property_domains domain
        on domain.tenant_id = property.tenant_id
       and domain.property_id = property.id
       and domain.is_active
       and domain.verification_status::text = 'verified'
      cross join public.roles manager_role
      cross join public.roles admin_role
      where property.status::text = 'active'
        and manager_role.code = 'property_ld_manager'
        and manager_role.scope_level::text = 'property'
        and manager_role.is_active
        and admin_role.code = 'department_training_admin'
        and admin_role.scope_level::text = 'department'
        and admin_role.is_active
      order by domain.is_primary desc, domain.hostname
      limit 1
    `);
    const scope = target.rows[0];
    if (!scope) throw new Error("E3_PHASE2A_SYNTHETIC_SCOPE_UNAVAILABLE");
    Object.assign(fixture, {
      tenantId: scope.tenant_id,
      propertyId: scope.property_id,
      hostname: scope.hostname,
      managerRoleId: scope.manager_role_id,
      adminRoleId: scope.admin_role_id,
    });

    await client.query(
      "insert into auth.users (id) values ($1::uuid),($2::uuid),($3::uuid),($4::uuid)",
      [
        fixture.managerProfileUserId,
        fixture.managerAuthUserId,
        fixture.adminProfileUserId,
        fixture.adminAuthUserId,
      ],
    );
    await client.query(
      `
        insert into public.profiles (
          id, email, display_name, is_active
        ) values
          ($1::uuid,$2::text,$3::text,true),
          ($4::uuid,$5::text,$6::text,true)
      `,
      [
        fixture.managerProfileUserId,
        `${fixture.codePrefix}-manager@example.invalid`,
        "E3 Phase 2A Synthetic Manager",
        fixture.adminProfileUserId,
        `${fixture.codePrefix}-admin@example.invalid`,
        "E3 Phase 2A Synthetic Department Admin",
      ],
    );
    await client.query(
      `
        insert into public.tenant_memberships (
          tenant_id, user_id, status, joined_at
        ) values
          ($1::uuid,$2::uuid,'active',pg_catalog.now()),
          ($1::uuid,$3::uuid,'active',pg_catalog.now())
      `,
      [
        fixture.tenantId,
        fixture.managerProfileUserId,
        fixture.adminProfileUserId,
      ],
    );
    await client.query(
      `
        insert into public.property_memberships (
          tenant_id, property_id, user_id, status, joined_at
        ) values
          ($1::uuid,$2::uuid,$3::uuid,'active',pg_catalog.now()),
          ($1::uuid,$2::uuid,$4::uuid,'active',pg_catalog.now())
      `,
      [
        fixture.tenantId,
        fixture.propertyId,
        fixture.managerProfileUserId,
        fixture.adminProfileUserId,
      ],
    );
    await client.query(
      `
        insert into public.user_accounts (
          user_id, auth_user_id, tenant_id, property_id,
          login_id, account_status, must_change_password
        ) values
          ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,'active',false),
          ($6::uuid,$7::uuid,$3::uuid,$4::uuid,$8::text,'active',false)
      `,
      [
        fixture.managerProfileUserId,
        fixture.managerAuthUserId,
        fixture.tenantId,
        fixture.propertyId,
        `${fixture.codePrefix}-manager`,
        fixture.adminProfileUserId,
        fixture.adminAuthUserId,
        `${fixture.codePrefix}-admin`,
      ],
    );
    await client.query(
      `
        insert into public.role_assignments (
          id, user_id, role_id, tenant_id, property_id, status
        ) values
          ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'active'),
          ($6::uuid,$7::uuid,$8::uuid,$4::uuid,$5::uuid,'active')
      `,
      [
        fixture.managerAssignmentId,
        fixture.managerProfileUserId,
        fixture.managerRoleId,
        fixture.tenantId,
        fixture.propertyId,
        fixture.adminAssignmentId,
        fixture.adminProfileUserId,
        fixture.adminRoleId,
      ],
    );
    await client.query("commit");
    return fixture;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function addDepartmentAdminScope(
  connectionString,
  fixture,
  departmentId,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `
        insert into public.trainer_scopes (
          role_assignment_id, tenant_id, property_id,
          department_id, include_descendants, is_active
        ) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,true,true)
      `,
      [
        fixture.adminAssignmentId,
        fixture.tenantId,
        fixture.propertyId,
        departmentId,
      ],
    );
  } finally {
    await client.end();
  }
}

async function runActorTransaction(
  connectionString,
  context,
  action,
  commit,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  let transactionOpen = false;
  try {
    await assertActorSettingsClear(client);
    await client.query("begin isolation level repeatable read");
    transactionOpen = true;
    const identity = await client.query(`
      select current_database() as database,
             current_user as current_user,
             session_user as session_user,
             (select rolbypassrls from pg_catalog.pg_roles
              where rolname = current_user) as bypassrls
    `);
    const identityRow = identity.rows[0];
    if (
      identityRow?.database !== DATABASE ||
      identityRow.current_user !== RUNTIME_ROLE ||
      identityRow.session_user !== RUNTIME_ROLE ||
      identityRow.bypassrls !== false
    ) {
      throw new Error("E3_PHASE2A_RUNTIME_IDENTITY_MISMATCH");
    }
    await client.query(
      `
        select
          pg_catalog.set_config(
            'app.actor_auth_user_id', $1::text, true
          ),
          pg_catalog.set_config(
            'app.actor_property_id', $2::text, true
          ),
          pg_catalog.set_config(
            'app.actor_request_id', $3::text, true
          )
      `,
      [context.authUserId, context.propertyId, context.requestId],
    );
    const result = await action(client);
    await client.query(commit ? "commit" : "rollback");
    transactionOpen = false;
    await assertActorSettingsClear(client);
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("rollback");
      } catch {
        // The original runtime failure remains authoritative.
      }
    }
    try {
      await assertActorSettingsClear(client);
    } catch (contextError) {
      throw new Error("E3_PHASE2A_ACTOR_CONTEXT_NOT_CLEARED", {
        cause: contextError,
      });
    }
    throw error;
  } finally {
    await client.end();
  }
}

async function assertActorSettingsClear(client) {
  const state = await client.query(`
    select (
      nullif(pg_catalog.btrim(pg_catalog.current_setting(
        'app.actor_auth_user_id', true
      )), '') is null
      and nullif(pg_catalog.btrim(pg_catalog.current_setting(
        'app.actor_property_id', true
      )), '') is null
      and nullif(pg_catalog.btrim(pg_catalog.current_setting(
        'app.actor_request_id', true
      )), '') is null
    ) as clear
  `);
  if (state.rows[0]?.clear !== true) {
    throw new Error("E3_PHASE2A_ACTOR_CONTEXT_CONTAMINATED");
  }
}

async function createDepartment(client, fixture, input) {
  const result = await client.query(
    `
      select public.create_neon_organization_department(
        $1::text,$2::uuid,$3::uuid,$4::uuid,$5::text,
        $6::text,$7::text,$8::text,$9::integer
      ) as payload
    `,
    [
      fixture.hostname,
      fixture.tenantId,
      fixture.propertyId,
      input.parentId,
      "department",
      input.code,
      input.nameZh,
      input.nameEn,
      input.sortOrder,
    ],
  );
  if (!result.rows[0]?.payload) {
    throw new Error("E3_PHASE2A_CREATE_PAYLOAD_MISSING");
  }
  return result.rows[0].payload;
}

async function updateDepartment(client, fixture, input) {
  const result = await client.query(
    `
      select public.update_neon_organization_department(
        $1::text,$2::uuid,$3::bigint,$4::text,$5::text,
        $6::integer,$7::boolean
      ) as payload
    `,
    [
      fixture.hostname,
      input.id,
      input.expectedVersion,
      input.nameZh,
      input.nameEn,
      input.sortOrder,
      input.isActive,
    ],
  );
  if (!result.rows[0]?.payload) {
    throw new Error("E3_PHASE2A_UPDATE_PAYLOAD_MISSING");
  }
  return result.rows[0].payload;
}

function assertDepartmentNode(node, expected) {
  if (
    !node ||
    node.tenant_id !== expected.tenantId ||
    node.property_id !== expected.propertyId ||
    node.parent_id !== expected.parentId ||
    node.depth !== expected.depth ||
    node.version !== expected.version ||
    node.is_active !== expected.isActive ||
    !Array.isArray(node.path_ids) ||
    node.path_ids.length !== expected.pathIds.length ||
    node.path_ids.some((id, index) => id !== expected.pathIds[index])
  ) {
    throw new Error("E3_PHASE2A_DEPARTMENT_PAYLOAD_ASSERTION_FAILED");
  }
}

async function expectDatabaseError(action, code, message) {
  try {
    await action();
  } catch (error) {
    if (error?.code === code && error.message === message) return;
    throw error;
  }
  throw new Error("E3_PHASE2A_EXPECTED_DATABASE_DENIAL_MISSING");
}

async function assertHierarchyEvidence(
  connectionString,
  fixture,
  rootId,
  childId,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin read only");
    const evidence = await client.query(
      `
        select
          (select count(*) from public.department_closure closure
           where closure.property_id = $1::uuid
             and closure.descendant_department_id = $2::uuid) = 1
            as root_closure,
          (select count(*) from public.department_closure closure
           where closure.property_id = $1::uuid
             and closure.descendant_department_id = $3::uuid) = 2
            as child_closure,
          exists (
            select 1 from public.department_closure closure
            where closure.property_id = $1::uuid
              and closure.ancestor_department_id = $2::uuid
              and closure.descendant_department_id = $3::uuid
              and closure.distance = 1
          ) as ancestor_edge
      `,
      [fixture.propertyId, rootId, childId],
    );
    const row = evidence.rows[0];
    if (!row?.root_closure || !row.child_closure || !row.ancestor_edge) {
      throw new Error("E3_PHASE2A_HIERARCHY_EVIDENCE_FAILED");
    }
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function assertRollbackEvidence(
  connectionString,
  requestId,
  departmentId,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await grantTemporaryAuditRead(client);
    const evidence = await client.query(
      `
        select
          not exists (
            select 1 from public.departments department
            where department.id = $1::uuid
          ) as department_absent,
          not exists (
            select 1
            from app_private.organization_write_audit_events audit
            where audit.request_id = $2::uuid
          ) as audit_absent
      `,
      [departmentId, requestId],
    );
    const row = evidence.rows[0];
    if (!row?.department_absent || !row.audit_absent) {
      throw new Error("E3_PHASE2A_ROLLBACK_EVIDENCE_FAILED");
    }
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function assertAuditEvidence(connectionString, fixture, expected) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await grantTemporaryAuditRead(client);
    const evidence = await client.query(
      `
        select
          count(*) filter (
            where audit.request_id = $1::uuid
              and audit.auth_user_id = $2::uuid
              and audit.actor_user_id = $3::uuid
              and audit.tenant_id = $4::uuid
              and audit.property_id = $5::uuid
              and audit.department_id = $6::uuid
              and audit.operation = 'department_create'
              and audit.previous_version is null
              and audit.result_version = 1
              and audit.previous_is_active is null
              and audit.result_is_active
          ) = 1 as create_correct,
          count(*) filter (
            where audit.request_id = $7::uuid
              and audit.auth_user_id = $2::uuid
              and audit.actor_user_id = $3::uuid
              and audit.property_id = $5::uuid
              and audit.department_id = $6::uuid
              and audit.operation = 'department_update'
              and audit.previous_version = 1
              and audit.result_version = 2
              and audit.previous_is_active
              and audit.result_is_active
              and audit.changed_fields @> array[
                'name_zh', 'name_en', 'sort_order'
              ]::text[]
          ) = 1 as update_correct,
          count(*) filter (
            where audit.request_id = $8::uuid
          ) = 0 as stale_absent
        from app_private.organization_write_audit_events audit
        where audit.request_id in ($1::uuid,$7::uuid,$8::uuid)
      `,
      [
        expected.rootRequestId,
        fixture.managerAuthUserId,
        fixture.managerProfileUserId,
        fixture.tenantId,
        fixture.propertyId,
        expected.rootId,
        expected.updateRequestId,
        expected.staleRequestId,
      ],
    );
    const row = evidence.rows[0];
    if (!row?.create_correct || !row.update_correct || !row.stale_absent) {
      throw new Error("E3_PHASE2A_AUDIT_EVIDENCE_FAILED");
    }
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

async function grantTemporaryAuditRead(client) {
  await client.query("set local role hotel_ld_migration_owner");
  await client.query(`
    grant select on app_private.organization_write_audit_events
      to neondb_owner
  `);
  await client.query("reset role");
}

async function assertRawRuntimeAccessDenied(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await expectDatabaseError(
      () => client.query("select id from public.departments limit 1"),
      "42501",
      "permission denied for table departments",
    );
    await expectDatabaseError(
      () => client.query(
        "insert into public.departments (tenant_id,property_id,name_zh) values ($1::uuid,$2::uuid,$3::text)",
        [randomUUID(), randomUUID(), "Denied"],
      ),
      "42501",
      "permission denied for table departments",
    );
  } finally {
    await client.end();
  }
}

async function cleanupValidationFixture(
  connectionString,
  fixture,
  departments,
) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    await client.query(
      "delete from public.trainer_scopes where role_assignment_id = $1::uuid",
      [fixture.adminAssignmentId],
    );
    if (departments.childId) {
      await client.query("delete from public.departments where id = $1::uuid", [
        departments.childId,
      ]);
    }
    if (departments.rootId) {
      await client.query("delete from public.departments where id = $1::uuid", [
        departments.rootId,
      ]);
    }
    await client.query(
      "delete from public.role_assignments where id in ($1::uuid,$2::uuid)",
      [fixture.managerAssignmentId, fixture.adminAssignmentId],
    );
    await client.query(
      "delete from public.user_accounts where auth_user_id in ($1::uuid,$2::uuid)",
      [fixture.managerAuthUserId, fixture.adminAuthUserId],
    );
    await client.query(
      "delete from public.property_memberships where user_id in ($1::uuid,$2::uuid)",
      [fixture.managerProfileUserId, fixture.adminProfileUserId],
    );
    await client.query(
      "delete from public.tenant_memberships where user_id in ($1::uuid,$2::uuid)",
      [fixture.managerProfileUserId, fixture.adminProfileUserId],
    );
    await client.query(
      "delete from public.profiles where id in ($1::uuid,$2::uuid)",
      [fixture.managerProfileUserId, fixture.adminProfileUserId],
    );
    await client.query(
      "delete from auth.users where id in ($1::uuid,$2::uuid,$3::uuid,$4::uuid)",
      [
        fixture.managerProfileUserId,
        fixture.managerAuthUserId,
        fixture.adminProfileUserId,
        fixture.adminAuthUserId,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw new Error("E3_PHASE2A_FIXTURE_CLEANUP_FAILED", { cause: error });
  } finally {
    await client.end();
  }
}

function actor(authUserId, propertyId, requestId) {
  return { authUserId, propertyId, requestId };
}

async function loadLocalEnvironment() {
  const source = await readFile(".env.local", "utf8");
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return { ...values, ...process.env };
}

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`E3_PHASE2A_${name}_MISSING`);
  return value;
}

const invokedAsScript = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (invokedAsScript) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "E3_PHASE2A_VALIDATION_FAILED");
    process.exitCode = 1;
  });
}
