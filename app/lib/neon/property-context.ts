import "server-only";

import type { NeonPool, NeonQueryable } from "./actor-context.ts";
import { createNeonPool } from "./server.ts";

type PropertyContextRow = {
  tenant_id: string;
  property_id: string;
  hostname: string;
  name_zh: string;
  name_en: string | null;
  short_name: string | null;
  brand: string | null;
  city: string | null;
  country_region: string;
  timezone: string;
  default_language: string;
  logo_url: string | null;
};

export type NeonPropertyScope = { tenantId: string; propertyId: string };

export type NeonPropertyContext = PropertyContextRow;

export async function resolveNeonPropertyScope(
  hostname: string,
  database: NeonQueryable,
): Promise<NeonPropertyScope | null> {
  const result = await database.query<Pick<PropertyContextRow, "tenant_id" | "property_id">>(
    `select tenant_id, property_id from public.resolve_neon_property_context($1::text)`,
    [hostname],
  );
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, propertyId: row.property_id } : null;
}

/** Public hostname context is intentionally actor-free and returns no business rows. */
export async function resolveNeonPublicPropertyContext(
  hostname: string,
  pool: NeonPool = createNeonPool(),
): Promise<NeonPropertyContext | null> {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    const result = await client.query<NeonPropertyContext>(
      `select * from public.resolve_neon_property_context($1::text)`,
      [hostname],
    );
    await client.query("COMMIT");
    open = false;
    return result.rows[0] ?? null;
  } catch (error) {
    if (open) {
      try { await client.query("ROLLBACK"); } catch { /* release below */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
