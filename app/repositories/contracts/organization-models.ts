export type DepartmentNodeType = "division" | "department" | "section" | "team" | "other";
export type DepartmentResolutionType = "mapped" | "created_top_level" | "created_child" | "merged" | "ignored" | "deferred";
export type OperationalUnitType = "venue" | "outlet" | "kitchen" | "restaurant" | "recreation" | "other";

export type DepartmentNode = {
  id: string; tenantId: string; propertyId: string; parentId: string | null;
  nodeType: DepartmentNodeType; code: string | null; nameZh: string; nameEn: string | null;
  sortOrder: number; depth: number; pathIds: string[]; isActive: boolean; version: number;
  syntheticEmployeeCount: number;
};

export type DepartmentMovePreview = {
  currentPath: string; proposedPath: string; childDepartmentsAffected: number;
  syntheticEmployeeImpact: number; aliasesAffected: number; operationalUnitsAffected: number;
};

export type DepartmentAlias = {
  id: string; propertyId: string; sourceSystem: string; sourceSheet: string; sourceValue: string;
  normalizedSourceValue: string; sourceRowCount: number; syntheticEmployeeCount: number;
  suggestedTargetId: string | null; suggestionLabel: string; confidence: number; suggestionReason: string;
  targetDepartmentId: string | null; operationalUnitId: string | null;
  resolutionType: DepartmentResolutionType; isActive: boolean;
};

export type OperationalUnit = {
  id: string; tenantId: string; propertyId: string; departmentId: string;
  parentOperationalUnitId: string | null; unitType: OperationalUnitType; code: string | null;
  nameZh: string; nameEn: string | null; sortOrder: number; isActive: boolean; version: number;
};

export type PositionFamily = {
  id: string; tenantId: string; propertyId: string; code: string; nameZh: string;
  nameEn: string | null; description: string | null; sortOrder: number; isActive: boolean;
  version: number;
};

export type OfficialPosition = {
  id: string; tenantId: string; propertyId: string; positionFamilyId: string | null;
  code: string; nameZh: string; nameEn: string | null; gradeOrBand: string | null;
  isActive: boolean; version: number; departmentIds: string[];
};

export type PositionResolutionStatus = "mapped" | "family_only" | "external_only" | "ignored" | "deferred";
export type PositionImpactAvailability<T> =
  | { state: "available"; value: T }
  | { state: "unavailable"; reason: "import_source_rows_not_migrated" };
export type PositionSourceImpact = {
  sourceLabelId: string;
  sourceEvidence: { sourceSystem: string; sourceSheet: string; sourceRowCount: number };
  /** Legacy UI field: source-row evidence, never inferred employee impact. */
  syntheticEmployeeCount: number;
  employeeImpact: PositionImpactAvailability<{ employeeCount: number }>;
  departmentImpact: PositionImpactAvailability<{ departmentNames: string[] }>;
};
export type PositionSourceLabel = {
  id: string; propertyId: string; sourceSystem: string; sourceSheet: string; sourceValue: string;
  normalizedSourceValue: string; sourceRowCount: number; syntheticEmployeeCount: number;
  suggestedPositionId: string | null; suggestedFamilyId: string | null; confidence: number;
  suggestionReason: string; targetPositionId: string | null; targetPositionFamilyId: string | null;
  externalRoleCode: string | null; externalRoleName: string | null; resolutionStatus: PositionResolutionStatus;
};
