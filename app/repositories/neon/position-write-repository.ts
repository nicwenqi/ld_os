import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type { PositionRepository, SavePositionFamilyInput, SavePositionWithDepartmentsInput } from "../contracts/position-repository.ts";
import type { OfficialPosition, PositionFamily } from "../contracts/organization-models.ts";
import { mapNeonOfficialPosition, mapNeonPositionFamily } from "./position-read-repository.ts";

type Row = { payload: unknown };
export type NeonPositionWriteRepository = Pick<PositionRepository, "savePositionFamily" | "savePositionWithDepartments">;

export function createNeonPositionWriteRepository(database: NeonQueryable, hostname: string): NeonPositionWriteRepository {
  return {
    async savePositionFamily(input: SavePositionFamilyInput): Promise<PositionFamily> {
      const result = await database.query<Row>("select public.save_neon_position_family($1::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::text,$7::text,$8::text,$9::text,$10::integer,$11::boolean) payload", [hostname,input.tenantId,input.propertyId,input.id ?? null,input.version ?? 0,input.code,input.nameZh,input.nameEn,input.description,input.sortOrder,input.isActive]);
      return mapNeonPositionFamily(result.rows[0]?.payload);
    },
    async savePositionWithDepartments(input: SavePositionWithDepartmentsInput): Promise<OfficialPosition> {
      const result = await database.query<Row>("select public.save_neon_position_with_departments($1::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint,$6::uuid,$7::text,$8::text,$9::text,$10::text,$11::boolean,$12::uuid[]) payload", [hostname,input.tenantId,input.propertyId,input.id ?? null,input.version ?? 0,input.positionFamilyId,input.code,input.nameZh,input.nameEn,input.gradeOrBand,input.isActive,input.departmentIds]);
      return mapNeonOfficialPosition(result.rows[0]?.payload);
    },
  };
}
