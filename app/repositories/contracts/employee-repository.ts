export type EmployeeRecord = {
  id: string;
  tenantId: string;
  propertyId: string;
  employeeNumber: string;
  nameZh: string | null;
  nameEn: string | null;
  departmentId: string;
  departmentName: string;
  operationalUnitId: string | null;
  operationalUnitName: string | null;
  positionId: string | null;
  positionName: string | null;
  positionFamilyId: string | null;
  positionFamilyName: string | null;
  gradeOrBand: string | null;
  hireDate: string | null;
  probationOrConfirmationDate: string | null;
  employmentStatus: "active" | "inactive" | "leave" | "terminated" | "unknown";
  isNewEmployee: boolean;
  isActive: boolean;
  externalIdentifierTypes: readonly string[];
  version: number;
};

export type EmployeeDirectoryOptions = {
  query?: string;
  departmentId?: string;
  positionId?: string;
  positionFamilyId?: string;
  employmentStatus?: EmployeeRecord["employmentStatus"];
  active?: boolean;
  limit?: number;
  offset?: number;
};

export type DepartmentEmployeeDirectoryOptions = Pick<EmployeeDirectoryOptions, "query" | "limit" | "offset">;

export type EmployeeDirectoryPage = {
  rows: readonly EmployeeRecord[];
  total: number;
  refreshedAt: string;
};

export interface EmployeeRepository {
  listEmployees(propertyId: string, options?: EmployeeDirectoryOptions): Promise<readonly EmployeeRecord[]>;
  listEmployeesPage(propertyId: string, options?: EmployeeDirectoryOptions): Promise<EmployeeDirectoryPage>;
  listDepartmentEmployees(options?: DepartmentEmployeeDirectoryOptions): Promise<EmployeeDirectoryPage>;
  getEmployee(id: string): Promise<EmployeeRecord | null>;
  findByEmployeeNumber(propertyId: string, employeeNumber: string): Promise<EmployeeRecord | null>;
  listExternalIdentifiers(employeeId: string): Promise<readonly { type: string; value: string; sourceSystem: string; isPrimary: boolean }[]>;
}
