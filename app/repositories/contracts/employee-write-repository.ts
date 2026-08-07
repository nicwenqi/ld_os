export type EmployeeEmploymentStatus =
  | "active"
  | "inactive"
  | "leave"
  | "terminated"
  | "unknown";

export type EmployeeIdentifierType =
  | "local_employee_number"
  | "lms_employee_id"
  | "merlin_id"
  | "hris_id"
  | "other";

export type EmployeeExternalIdentifierInput = {
  sourceSystem: string;
  identifierType: EmployeeIdentifierType;
  identifierValue: string;
  isPrimary: boolean;
  isActive: boolean;
};

export type SaveEmployeeWithIdentifiersInput = {
  id: string | null;
  expectedVersion: number;
  employeeNumber: string;
  nameZh: string | null;
  nameEn: string | null;
  departmentId: string | null;
  operationalUnitId: string | null;
  positionId: string | null;
  positionFamilyId: string | null;
  gradeOrBand: string | null;
  hireDate: string | null;
  probationOrConfirmationDate: string | null;
  employmentStatus: EmployeeEmploymentStatus;
  isActive: boolean;
  identifiers: readonly EmployeeExternalIdentifierInput[];
};

export type SavedEmployee = Omit<
  SaveEmployeeWithIdentifiersInput,
  "id" | "expectedVersion"
> & {
  id: string;
  version: number;
};

export interface EmployeeWriteRepository {
  saveEmployeeWithIdentifiers(
    input: SaveEmployeeWithIdentifiersInput,
  ): Promise<SavedEmployee>;
}
