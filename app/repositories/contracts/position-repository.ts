export interface PositionRepository {
  list(propertyId: string): Promise<readonly unknown[]>;
}
