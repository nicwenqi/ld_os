import type { Pool, PoolClient } from "pg";

import { createNeonPool } from "./server.ts";

export type NeonQueryable = Pick<PoolClient, "query">;
export type NeonPool = Pick<Pool, "connect">;

export type NeonActorInput = {
  authUserId: string;
  propertyId: string;
  requestId: string;
};

export type NeonResolvedActorInput = Omit<NeonActorInput, "propertyId">;

type ActorContextStateRow = {
  contaminated: boolean;
};

type ActorContextMatchRow = {
  matches: boolean;
};

type RuntimeRoleAssertionRow = {
  authorized: boolean;
};

class NeonActorContextSafetyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NeonActorContextSafetyError";
  }
}

const ACTOR_CONTEXT_STATE_QUERY = `
  select (
    nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_auth_user_id', true)), '') is not null
    or nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_property_id', true)), '') is not null
    or nullif(pg_catalog.btrim(pg_catalog.current_setting('app.actor_request_id', true)), '') is not null
  ) as contaminated
`;

async function assertActorContextIsClear(client: PoolClient) {
  let result;

  try {
    result = await client.query<ActorContextStateRow>(ACTOR_CONTEXT_STATE_QUERY);
  } catch (cause) {
    throw new NeonActorContextSafetyError(
      "NEON_ACTOR_CONTEXT_LEAK_CHECK_FAILED",
      { cause },
    );
  }

  if (result.rows[0]?.contaminated !== false) {
    throw new NeonActorContextSafetyError(
      "NEON_ACTOR_CONTEXT_CONTAMINATED",
    );
  }
}

async function assertRuntimeRole(client: PoolClient) {
  let result;

  try {
    result = await client.query<RuntimeRoleAssertionRow>(`
      select (
        current_database() = 'neondb'
        and current_user = 'hotel_ld_application'
        and session_user = 'hotel_ld_application'
        and exists (
          select 1
          from pg_catalog.pg_roles as runtime_role
          where runtime_role.rolname = current_user
            and runtime_role.rolcanlogin
            and not runtime_role.rolsuper
            and not runtime_role.rolbypassrls
            and not runtime_role.rolcreatedb
            and not runtime_role.rolcreaterole
            and not runtime_role.rolreplication
            and not runtime_role.rolinherit
        )
        and (
          select count(*)
          from pg_catalog.pg_auth_members as membership
          join pg_catalog.pg_roles as member_role
            on member_role.oid = membership.member
          where member_role.rolname = current_user
        ) = 1
        and exists (
          select 1
          from pg_catalog.pg_auth_members as membership
          join pg_catalog.pg_roles as granted_role
            on granted_role.oid = membership.roleid
          join pg_catalog.pg_roles as member_role
            on member_role.oid = membership.member
          where member_role.rolname = current_user
            and granted_role.rolname = 'hotel_ld_people_read'
            and membership.inherit_option
            and not membership.set_option
            and not membership.admin_option
        )
        and not exists (
          select 1
          from (
            select relation.relowner as owner_oid,
                   relation.relnamespace as namespace_oid
            from pg_catalog.pg_class as relation
            union all
            select routine.proowner, routine.pronamespace
            from pg_catalog.pg_proc as routine
            union all
            select data_type.typowner, data_type.typnamespace
            from pg_catalog.pg_type as data_type
          ) as owned_object
          join pg_catalog.pg_namespace as namespace
            on namespace.oid = owned_object.namespace_oid
          join pg_catalog.pg_roles as owner_role
            on owner_role.oid = owned_object.owner_oid
          where namespace.nspname in ('public', 'auth', 'app_private')
            and owner_role.rolname in (
              'hotel_ld_application',
              'hotel_ld_people_read'
            )
        )
        and not exists (
          select 1
          from pg_catalog.pg_namespace as namespace
          join pg_catalog.pg_roles as owner_role
            on owner_role.oid = namespace.nspowner
          where namespace.nspname in ('public', 'auth', 'app_private')
            and owner_role.rolname in (
              'hotel_ld_application',
              'hotel_ld_people_read'
            )
        )
        and not exists (
          select 1
          from pg_catalog.pg_database as database_record
          join pg_catalog.pg_roles as owner_role
            on owner_role.oid = database_record.datdba
          where database_record.datname = current_database()
            and owner_role.rolname in (
              'hotel_ld_application',
              'hotel_ld_people_read'
            )
        )
        and not pg_catalog.pg_has_role(
          current_user,
          'neon_superuser',
          'MEMBER'
        )
        and not pg_catalog.pg_has_role(
          current_user,
          'neondb_owner',
          'MEMBER'
        )
        and not pg_catalog.pg_has_role(
          current_user,
          'hotel_ld_migration_owner',
          'MEMBER'
        )
        and not pg_catalog.pg_has_role(
          current_user,
          'authenticated',
          'MEMBER'
        )
      ) as authorized
    `);
  } catch (cause) {
    throw new NeonActorContextSafetyError(
      "NEON_RUNTIME_ROLE_CHECK_FAILED",
      { cause },
    );
  }

  if (result.rows[0]?.authorized !== true) {
    throw new NeonActorContextSafetyError(
      "NEON_RUNTIME_ROLE_NOT_AUTHORIZED",
    );
  }
}

/** Runs one authorized operation on one checked-out, actor-scoped client. */
export async function withNeonActorContext<T>(
  input: NeonActorInput,
  action: (database: NeonQueryable) => Promise<T>,
  pool: NeonPool = createNeonPool(),
): Promise<T> {
  return runNeonActorTransaction(
    input,
    async () => input.propertyId,
    action,
    pool,
    "BEGIN",
  );
}

/**
 * Resolves a property on the checked-out E2 connection before setting actor
 * context. REPEATABLE READ keeps hostname, live authorization and People rows
 * on one request-consistent database snapshot.
 */
export async function withNeonResolvedActorContext<T>(
  input: NeonResolvedActorInput,
  resolvePropertyId: (database: NeonQueryable) => Promise<string>,
  action: (database: NeonQueryable) => Promise<T>,
  pool: NeonPool = createNeonPool(),
): Promise<T> {
  return runNeonActorTransaction(
    input,
    resolvePropertyId,
    action,
    pool,
    "BEGIN ISOLATION LEVEL REPEATABLE READ",
  );
}

async function runNeonActorTransaction<T>(
  input: NeonResolvedActorInput,
  resolvePropertyId: (database: NeonQueryable) => Promise<string>,
  action: (database: NeonQueryable) => Promise<T>,
  pool: NeonPool,
  beginStatement: "BEGIN" | "BEGIN ISOLATION LEVEL REPEATABLE READ",
): Promise<T> {
  const client = await pool.connect();
  let transactionOpen = false;
  let discardError: Error | undefined;

  try {
    await assertActorContextIsClear(client);

    try {
      try {
        await client.query(beginStatement);
      } catch (cause) {
        throw new NeonActorContextSafetyError(
          "NEON_ACTOR_CONTEXT_BEGIN_FAILED",
          { cause },
        );
      }
      transactionOpen = true;

      await assertRuntimeRole(client);
      const propertyId = await resolvePropertyId(client);

      await client.query(
        `
          select
            pg_catalog.set_config('app.actor_auth_user_id', $1::text, true) is not null,
            pg_catalog.set_config('app.actor_property_id', $2::text, true) is not null,
            pg_catalog.set_config('app.actor_request_id', $3::text, true) is not null
        `,
        [input.authUserId, propertyId, input.requestId],
      );

      /*
       * Runtime has no app_private USAGE by design. Validate the transaction-
       * local values directly; privileged repository entry points call the
       * private database assertion under their constrained definer owner.
       */
      const contextMatch = await client.query<ActorContextMatchRow>(
        `
          select (
            pg_catalog.current_setting('app.actor_auth_user_id', true)::uuid = $1::uuid
            and pg_catalog.current_setting('app.actor_property_id', true)::uuid = $2::uuid
            and pg_catalog.current_setting('app.actor_request_id', true)::uuid = $3::uuid
          ) as matches
        `,
        [input.authUserId, propertyId, input.requestId],
      );

      if (contextMatch.rows[0]?.matches !== true) {
        throw new NeonActorContextSafetyError(
          "NEON_ACTOR_CONTEXT_SET_FAILED",
        );
      }

      const result = await action(client);

      await client.query("COMMIT");
      transactionOpen = false;
      await assertActorContextIsClear(client);

      return result;
    } catch (cause) {
      if (transactionOpen) {
        try {
          await client.query("ROLLBACK");
          transactionOpen = false;
        } catch (rollbackCause) {
          discardError = new NeonActorContextSafetyError(
            "NEON_ACTOR_CONTEXT_ROLLBACK_FAILED",
            { cause: rollbackCause },
          );
        }

        if (!transactionOpen) {
          try {
            await assertActorContextIsClear(client);
          } catch (cleanupCause) {
            discardError =
              cleanupCause instanceof Error
                ? cleanupCause
                : new NeonActorContextSafetyError(
                    "NEON_ACTOR_CONTEXT_CLEANUP_FAILED",
                  );
          }
        }
      }

      if (cause instanceof NeonActorContextSafetyError) {
        discardError = cause;
      }

      if (discardError) {
        throw new NeonActorContextSafetyError(
          "NEON_ACTOR_CONTEXT_TRANSACTION_FAILED_CLOSED",
          { cause },
        );
      }

      throw cause;
    }
  } catch (cause) {
    if (cause instanceof NeonActorContextSafetyError) {
      discardError = cause;
    }

    throw cause;
  } finally {
    client.release(discardError);
  }
}
