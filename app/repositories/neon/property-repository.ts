import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  PropertyRepository,
  SaveBusinessRulesInput,
  SavePropertyIdentityInput,
  UploadPropertyLogoInput,
} from "../contracts/property-repository.ts";
import type { HotelPropertyRecord } from "../contracts/models.ts";
import type { PropertyContext } from "../contracts/models.ts";

export function createNeonPropertyRepository(
  database: NeonQueryable,
  hostname: string,
): PropertyRepository {
  return {
    async resolveContext(candidateHostname): Promise<PropertyContext | null> {
      const result = await database.query<PropertyContext & {
        tenant_id: string; property_id: string; name_zh: string; name_en: string | null;
        short_name: string | null; logo_url: string | null;
      }>(
        `select * from public.resolve_neon_property_context($1::text)`,
        [candidateHostname],
      );
      const row = result.rows[0];
      return row ? {
        tenantId: row.tenant_id,
        propertyId: row.property_id,
        hostname: row.hostname,
        nameZh: row.name_zh,
        nameEn: row.name_en ?? row.name_zh,
        shortName: row.short_name ?? row.name_zh,
        logoUrl: row.logo_url,
      } : null;
    },
    async getProperty() {
      const result = await database.query<{ read_neon_property: HotelPropertyRecord }>(
        `select public.read_neon_property($1::text) as read_neon_property`,
        [hostname],
      );
      const value = result.rows[0]?.read_neon_property;
      if (!value) throw new Error("NEON_PROPERTY_NOT_FOUND");
      return value;
    },
    async saveIdentity(input: SavePropertyIdentityInput) {
      const result = await database.query<{ save_neon_property_identity: HotelPropertyRecord }>(
        `select public.save_neon_property_identity($1::text,$2::timestamptz,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text,$9::text,$10::text,$11::text) as save_neon_property_identity`,
        [hostname, input.expectedUpdatedAt, input.code, input.nameZh, input.nameEn, input.shortName, input.brand, input.city, input.countryRegion, input.timezone, input.defaultLanguage],
      );
      return result.rows[0]!.save_neon_property_identity;
    },
    async saveBusinessRules(input: SaveBusinessRulesInput) {
      const result = await database.query<{ save_neon_property_settings: HotelPropertyRecord }>(
        `select public.save_neon_property_settings($1::text,$2::bigint,$3::smallint,$4::text,$5::text,$6::boolean,$7::boolean) as save_neon_property_settings`,
        [hostname, input.expectedVersion, input.newEmployeeDays, input.probationFieldMeaning, input.employeeStatusSource, input.ctcMandatory, input.gtcMandatory],
      );
      return result.rows[0]!.save_neon_property_settings;
    },
    uploadLogo(_input: UploadPropertyLogoInput) {
      return Promise.reject(new Error("Neon Property 不包含 Supabase Storage；品牌资产仍由 Storage 边界处理"));
    },
    cleanupExpiredLogos() {
      return Promise.reject(new Error("Neon Property 不包含 Supabase Storage；品牌资产清理由 Storage 边界处理"));
    },
  };
}
