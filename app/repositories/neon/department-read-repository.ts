import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type { DepartmentNode, DepartmentNodeType } from "../contracts/organization-models.ts";

type PayloadRow = { payload: unknown };

type NeonDepartmentPayload = {
  rows: unknown;
};

export type NeonDepartmentReadRepository = {
  listTree(): Promise<DepartmentNode[]>;
  getNode(id: string): Promise<DepartmentNode | null>;
  getAncestors(id: string): Promise<DepartmentNode[]>;
  getDescendants(id: string): Promise<DepartmentNode[]>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_TYPES = new Set<DepartmentNodeType>([
  "division",
  "department",
  "section",
  "team",
  "other",
]);

export function createNeonDepartmentReadRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonDepartmentReadRepository {
  let treePromise: Promise<DepartmentNode[]> | undefined;

  const loadTree = () => {
    treePromise ??= readTree(database, trustedHostname);
    return treePromise;
  };

  return {
    listTree: loadTree,
    async getNode(id) {
      return (await loadTree()).find(node => node.id === id) ?? null;
    },
    async getAncestors(id) {
      const tree = await loadTree();
      const node = tree.find(candidate => candidate.id === id);
      if (!node) return [];
      const nodesById = new Map(tree.map(candidate => [candidate.id, candidate]));
      return node.pathIds
        .slice(0, -1)
        .map(ancestorId => nodesById.get(ancestorId))
        .filter((ancestor): ancestor is DepartmentNode => ancestor !== undefined);
    },
    async getDescendants(id) {
      return (await loadTree()).filter(
        node => node.id !== id && node.pathIds.includes(id),
      );
    },
  };
}

async function readTree(
  database: NeonQueryable,
  trustedHostname: string,
): Promise<DepartmentNode[]> {
  const result = await database.query<PayloadRow>(
    "select public.read_neon_organization_department_tree($1::text) as payload",
    [trustedHostname],
  );
  return orderedTree(result.rows[0]?.payload);
}

function orderedTree(value: unknown): DepartmentNode[] {
  const payload = object(value, "payload") as NeonDepartmentPayload;
  const nodes = array(payload.rows, "rows").map(mapNode);
  const nodesById = new Map<string, DepartmentNode>();

  for (const node of nodes) {
    if (nodesById.has(node.id)) invalid("duplicate node id");
    nodesById.set(node.id, node);
  }

  const [firstNode] = nodes;
  if (firstNode) {
    for (const node of nodes) {
      if (
        node.tenantId !== firstNode.tenantId ||
        node.propertyId !== firstNode.propertyId
      ) {
        invalid("tenant or property mismatch");
      }
      validateHierarchy(node, nodesById);
    }
  }

  return sortTree(nodes, nodesById);
}

function mapNode(value: unknown): DepartmentNode {
  const row = object(value, "department row");
  const id = uuid(row.id, "id");
  const pathIds = array(row.path_ids, "path_ids").map((pathId, index) =>
    uuid(pathId, `path_ids[${index}]`),
  );
  const nodeType = enumValue(row.node_type, "node_type");

  return {
    id,
    tenantId: uuid(row.tenant_id, "tenant_id"),
    propertyId: uuid(row.property_id, "property_id"),
    parentId: nullableUuid(row.parent_id, "parent_id"),
    nodeType,
    code: nullableString(row.code, "code"),
    nameZh: string(row.name_zh, "name_zh"),
    nameEn: nullableString(row.name_en, "name_en"),
    sortOrder: safeInteger(row.sort_order, "sort_order"),
    depth: safeInteger(row.depth, "depth"),
    pathIds,
    isActive: boolean(row.is_active, "is_active"),
    version: safeInteger(row.version, "version"),
    syntheticEmployeeCount: safeInteger(
      row.synthetic_employee_count,
      "synthetic_employee_count",
    ),
  };
}

function validateHierarchy(
  node: DepartmentNode,
  nodesById: Map<string, DepartmentNode>,
) {
  if (
    node.pathIds.length === 0 ||
    node.pathIds.at(-1) !== node.id ||
    node.depth !== node.pathIds.length - 1 ||
    new Set(node.pathIds).size !== node.pathIds.length
  ) {
    invalid("invalid node path");
  }

  if (node.parentId === null) {
    if (node.pathIds.length !== 1) invalid("root path mismatch");
    return;
  }

  if (
    node.pathIds.length < 2 ||
    node.pathIds.at(-2) !== node.parentId
  ) {
    invalid("parent path mismatch");
  }

  const parent = nodesById.get(node.parentId);
  if (!parent) return;
  if (
    parent.depth !== node.depth - 1 ||
    parent.pathIds.length !== node.pathIds.length - 1 ||
    !parent.pathIds.every((pathId, index) => pathId === node.pathIds[index])
  ) {
    invalid("parent hierarchy mismatch");
  }
}

function sortTree(
  nodes: DepartmentNode[],
  nodesById: Map<string, DepartmentNode>,
): DepartmentNode[] {
  const childrenByParent = new Map<string, DepartmentNode[]>();
  const roots: DepartmentNode[] = [];

  for (const node of nodes) {
    if (node.parentId === null || !nodesById.has(node.parentId)) {
      roots.push(node);
      continue;
    }
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  }

  const compareNodes = (left: DepartmentNode, right: DepartmentNode) =>
    left.sortOrder - right.sortOrder ||
    left.nameZh.localeCompare(right.nameZh, "zh-CN") ||
    left.id.localeCompare(right.id);
  const ordered: DepartmentNode[] = [];
  const append = (node: DepartmentNode) => {
    ordered.push(node);
    for (const child of (childrenByParent.get(node.id) ?? []).sort(compareNodes)) {
      append(child);
    }
  };

  for (const root of roots.sort(compareNodes)) append(root);
  if (ordered.length !== nodes.length) invalid("cyclic tree");
  return ordered;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(label);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") invalid(label);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function uuid(value: unknown, label: string): string {
  const candidate = string(value, label);
  if (!UUID_PATTERN.test(candidate)) invalid(label);
  return candidate;
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : uuid(value, label);
}

function enumValue(value: unknown, label: string): DepartmentNodeType {
  if (typeof value !== "string" || !NODE_TYPES.has(value as DepartmentNodeType)) {
    invalid(label);
  }
  return value as DepartmentNodeType;
}

function safeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) invalid(label);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(label);
  return value;
}

function invalid(detail: string): never {
  throw new Error(`NEON_ORGANIZATION_PAYLOAD_INVALID:${detail}`);
}
