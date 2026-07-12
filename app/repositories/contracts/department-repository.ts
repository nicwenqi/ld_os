export interface DepartmentRepository {
  listTree(propertyId: string): Promise<readonly unknown[]>;
}
