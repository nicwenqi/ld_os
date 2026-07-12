import type { OfficialPosition, PositionFamily, PositionSourceLabel } from "./organization-models.ts";

export type SavePositionFamilyInput = Omit<PositionFamily, "id"> & { id?: string };
export type SavePositionInput = Omit<OfficialPosition, "id" | "version" | "departmentIds"> & { id?: string; version?: number };
export type ApprovePositionMappingInput = { sourceLabelId: string; action: "position" | "family" | "external" | "ignore" | "defer"; targetPositionId?: string; targetPositionFamilyId?: string; externalRoleCode?: string; externalRoleName?: string };

export interface PositionRepository {
  listPositionFamilies(propertyId: string): Promise<PositionFamily[]>;
  savePositionFamily(input: SavePositionFamilyInput): Promise<PositionFamily>;
  listPositions(propertyId: string): Promise<OfficialPosition[]>;
  savePosition(input: SavePositionInput): Promise<OfficialPosition>;
  assignPositionToDepartments(positionId: string, departmentIds: string[]): Promise<OfficialPosition>;
  listSourceLabels(propertyId: string): Promise<PositionSourceLabel[]>;
  previewSourceImpact(sourceLabelId: string): Promise<{ syntheticEmployeeCount: number; departmentNames: string[] }>;
  approvePositionMapping(input: ApprovePositionMappingInput): Promise<PositionSourceLabel>;
}
