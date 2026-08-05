export type PeopleFacetOption = {
  id: string;
  label: string;
};

export type ManagerPeopleFacets = {
  departments: PeopleFacetOption[];
  positions: PeopleFacetOption[];
  positionFamilies: PeopleFacetOption[];
};

export interface PeopleFacetRepository {
  listManagerFacets(): Promise<ManagerPeopleFacets>;
}
