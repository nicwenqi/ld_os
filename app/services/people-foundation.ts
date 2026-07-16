import type { DepartmentNode, OfficialPosition, PositionFamily } from "../repositories/contracts/organization-models.ts";
import type { createRepositoryRegistry } from "../repositories/registry.ts";

type Registry = Pick<
  ReturnType<typeof createRepositoryRegistry>,
  "department" | "position"
>;

export type PeopleFacetOption = {
  id: string;
  label: string;
};

export type ManagerPeopleFacets = {
  departments: PeopleFacetOption[];
  positions: PeopleFacetOption[];
  positionFamilies: PeopleFacetOption[];
};

/**
 * Reads filter authority from the official organization repositories. Employee
 * pages remain paginated and are never repurposed as a source of filter values.
 */
export async function loadManagerPeopleFacets(
  registry: Registry,
  propertyId: string,
): Promise<ManagerPeopleFacets> {
  if (!propertyId) {
    throw new Error("当前酒店范围无法确认");
  }

  const [departments, positions, positionFamilies] = await Promise.all([
    registry.department.listTree(propertyId),
    registry.position.listPositions(propertyId),
    registry.position.listPositionFamilies(propertyId),
  ]);

  return {
    departments: activeOptions(
      departments,
      propertyId,
      department => department.sortOrder,
    ),
    positions: activeOptions(positions, propertyId),
    positionFamilies: activeOptions(
      positionFamilies,
      propertyId,
      family => family.sortOrder,
    ),
  };
}

function activeOptions<
  T extends DepartmentNode | OfficialPosition | PositionFamily,
>(
  rows: readonly T[],
  propertyId: string,
  order?: (row: T) => number,
): PeopleFacetOption[] {
  return rows
    .filter(row => row.propertyId === propertyId && row.isActive)
    .map(row => ({
      id: row.id,
      label: row.nameZh,
      order: order?.(row) ?? 0,
    }))
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.label.localeCompare(right.label, "zh-CN"),
    )
    .map(({ id, label }) => ({ id, label }));
}
