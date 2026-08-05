import "server-only";

import type { NeonQueryable } from "./actor-context.ts";

type PropertyResolverDatabase = NeonQueryable;

type PropertyScopeRow = {
  tenant_id: string;
  property_id: string;
};

export type NeonPeoplePropertyScope = {
  tenantId: string;
  propertyId: string;
};

/**
 * Resolves only a trusted server hostname through the constrained application
 * credential. Every People entry point revalidates this mapping inside the
 * actor transaction before reading business rows.
 */
export async function resolveNeonPeoplePropertyScope(
  hostname: string,
  database: PropertyResolverDatabase,
): Promise<NeonPeoplePropertyScope | null> {
  const result = await database.query<PropertyScopeRow>(
    `
      select tenant_id, property_id
      from public.resolve_neon_people_property($1::text)
    `,
    [hostname],
  );
  const row = result.rows[0];
  return row
    ? { tenantId: row.tenant_id, propertyId: row.property_id }
    : null;
}
