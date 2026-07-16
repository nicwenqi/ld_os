import type { DepartmentAlias, DepartmentMovePreview, DepartmentNode, DepartmentNodeType, DepartmentResolutionType, OperationalUnit, OperationalUnitType } from "./organization-models.ts";

export type CreateDepartmentInput = { tenantId: string; propertyId: string; parentId: string | null; nodeType: DepartmentNodeType; code: string; nameZh: string; nameEn: string; sortOrder: number };
export type UpdateDepartmentInput = { id: string; expectedVersion: number; nameZh: string; nameEn: string; sortOrder: number; isActive: boolean };
export type CreateOperationalUnitInput = { tenantId: string; propertyId: string; departmentId: string; parentOperationalUnitId: string | null; unitType: OperationalUnitType; code: string; nameZh: string; nameEn: string; sortOrder: number };
export type SaveOperationalUnitInput = CreateOperationalUnitInput & {
  id?: string;
  expectedVersion?: number;
  isActive: boolean;
};
export type ApproveDepartmentMappingInput = { aliasId: string; action: "department" | "operational_unit" | "ignore" | "defer" | "merge"; targetDepartmentId?: string; operationalUnitId?: string; resolutionType?: DepartmentResolutionType };

export interface DepartmentRepository {
  listTree(propertyId: string): Promise<DepartmentNode[]>;
  getNode(id: string): Promise<DepartmentNode>;
  getAncestors(id: string): Promise<DepartmentNode[]>;
  getDescendants(id: string): Promise<DepartmentNode[]>;
  createNode(input: CreateDepartmentInput): Promise<DepartmentNode>;
  updateNode(input: UpdateDepartmentInput): Promise<DepartmentNode>;
  previewMove(id: string, newParentId: string | null): Promise<DepartmentMovePreview>;
  moveNode(id: string, newParentId: string | null, expectedVersion: number): Promise<DepartmentNode>;
  setActive(id: string, expectedVersion: number, active: boolean): Promise<DepartmentNode>;
  listAliases(propertyId: string): Promise<DepartmentAlias[]>;
  approveMapping(input: ApproveDepartmentMappingInput): Promise<DepartmentAlias>;
  createOperationalUnit(input: CreateOperationalUnitInput): Promise<OperationalUnit>;
  saveOperationalUnit(input: SaveOperationalUnitInput): Promise<OperationalUnit>;
  listOperationalUnits(propertyId: string): Promise<OperationalUnit[]>;
}
