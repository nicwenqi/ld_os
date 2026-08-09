export interface ExampleRepository {
  listThings(): Promise<readonly string[]>;
}
