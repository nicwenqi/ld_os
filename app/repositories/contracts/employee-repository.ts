export type EmployeeRecord = {
  id: string; tenantId: string; propertyId: string; employeeNumber: string; nameZh: string | null; nameEn: string | null;
  departmentId: string; departmentName: string; operationalUnitId: string | null; operationalUnitName: string | null;
  positionId: string | null; positionName: string | null; positionFamilyId: string | null; positionFamilyName: string | null;
  gradeOrBand: string | null; hireDate: string | null; probationOrConfirmationDate: string | null;
  employmentStatus: "active"|"inactive"|"leave"|"terminated"|"unknown"; isNewEmployee: boolean; isActive: boolean;
  externalIdentifierTypes: readonly string[]; version: number;
};
export type EmployeeChanges = { action:"insert"|"update"|"unchanged"|"unresolved"; before:EmployeeRecord|null; after:Partial<EmployeeRecord>; reasons:readonly string[] };
export interface EmployeeRepository {
  listEmployees(propertyId:string,options?:{query?:string;departmentId?:string;active?:boolean}):Promise<readonly EmployeeRecord[]>;
  getEmployee(id:string):Promise<EmployeeRecord|null>; findByEmployeeNumber(propertyId:string,employeeNumber:string):Promise<EmployeeRecord|null>;
  previewEmployeeChanges(propertyId:string,input:Partial<EmployeeRecord>&{employeeNumber:string}):Promise<EmployeeChanges>;
  createEmployee(input:Omit<EmployeeRecord,"id"|"departmentName"|"operationalUnitName"|"positionName"|"positionFamilyName"|"externalIdentifierTypes"|"version">):Promise<EmployeeRecord>;
  updateEmployee(id:string,version:number,changes:Partial<EmployeeRecord>):Promise<EmployeeRecord>;
  activateEmployee(id:string,version:number):Promise<EmployeeRecord>; deactivateEmployee(id:string,version:number):Promise<EmployeeRecord>;
  listExternalIdentifiers(employeeId:string):Promise<readonly {type:string;value:string;sourceSystem:string;isPrimary:boolean}[]>;
}
