import type {
  ManagerPeopleFacets,
  PeopleFacetRepository,
} from "../contracts/people-facet-repository.ts";

export function createHttpPeopleFacetRepository(): PeopleFacetRepository {
  return {
    async listManagerFacets(): Promise<ManagerPeopleFacets> {
      const response = await fetch("/api/people/facets", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const payload = await response.json() as ManagerPeopleFacets & {
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? "组织筛选条件读取失败");
      }
      return payload;
    },
  };
}
