export interface EmployeeRepository {
  search(propertyId: string, query: string): Promise<readonly unknown[]>;
}
