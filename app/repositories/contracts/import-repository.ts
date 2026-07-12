export interface ImportRepository {
  listBatches(propertyId: string): Promise<readonly unknown[]>;
}
