import "server-only";

import type { NeonQueryable } from "./actor-context.ts";

type PropertyScopeRow = {
  tenant_id: string;
  property_id: string;
};

export type NeonOrganizationPropertyScope = {
  tenantId: string;
  propertyId: string;
};

export async function resolveNeonOrganizationPropertyScope(
  hostname: string,
  database: NeonQueryable,
): Promise<NeonOrganizationPropertyScope | null> {
  const result = await database.query<PropertyScopeRow>(
    `
      select tenant_id, property_id
      from public.resolve_neon_organization_property($1::text)
    `,
    [hostname],
  );
  const row = result.rows[0];
  return row
    ? { tenantId: row.tenant_id, propertyId: row.property_id }
    : null;
}
