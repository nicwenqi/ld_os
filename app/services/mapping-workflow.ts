export type MappingItemType = "department" | "position";
export type MappingItemStatus = "pending" | "mapped" | "ignored" | "deferred" | "blocked" | "family_only" | "external_only" | "merged";
export type MappingItem = {
  id: string;
  type: MappingItemType;
  sourceLabel: string;
  affectedRows: number;
  sourceSheet: string;
  suggestedTarget: string | null;
  confidence: number;
  suggestionReason: string;
  targetLabel: string | null;
  status: MappingItemStatus;
  blocked: boolean;
  batchEligible?: boolean;
};
export type MappingFilters = {
  query: string;
  type: "all" | MappingItemType;
  status: "all" | MappingItemStatus;
  unresolvedOnly: boolean;
  sortBy: "affectedRows" | "confidence" | "sourceLabel" | "status";
};

const resolvedStatuses = new Set<MappingItemStatus>(["mapped", "ignored", "family_only", "external_only", "merged"]);

export function isResolvedMapping(item: MappingItem) {
  return resolvedStatuses.has(item.status);
}

export function filterMappingItems(items: readonly MappingItem[], filters: MappingFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return items.filter(item => {
    if (filters.type !== "all" && item.type !== filters.type) return false;
    if (filters.status !== "all" && item.status !== filters.status) return false;
    if (filters.unresolvedOnly && isResolvedMapping(item)) return false;
    return !query || `${item.sourceLabel} ${item.suggestedTarget ?? ""} ${item.targetLabel ?? ""}`.toLocaleLowerCase().includes(query);
  }).sort((left, right) => {
    if (filters.sortBy === "affectedRows") return right.affectedRows - left.affectedRows || left.sourceLabel.localeCompare(right.sourceLabel);
    if (filters.sortBy === "confidence") return right.confidence - left.confidence || right.affectedRows - left.affectedRows;
    if (filters.sortBy === "status") return left.status.localeCompare(right.status) || right.affectedRows - left.affectedRows;
    return left.sourceLabel.localeCompare(right.sourceLabel, "zh-CN");
  });
}

export function getMappingSummary(items: readonly MappingItem[]) {
  const count = (status: MappingItemStatus) => items.filter(item => item.status === status).length;
  const resolved = items.filter(isResolvedMapping).length;
  return {
    total: items.length,
    resolved,
    pending: count("pending"),
    deferred: count("deferred"),
    ignored: count("ignored"),
    blocked: count("blocked"),
    unresolved: items.length - resolved,
    affectedRows: items.reduce((sum, item) => sum + item.affectedRows, 0),
    progressPercent: items.length ? Math.round(resolved / items.length * 100) : 100,
  };
}

export function selectHighConfidenceMappings(items: readonly MappingItem[], selectedIds: ReadonlySet<string>, threshold = 90) {
  return items.filter(item => selectedIds.has(item.id) && !item.blocked && item.batchEligible !== false && !isResolvedMapping(item) && Boolean(item.suggestedTarget) && item.confidence >= threshold).map(item => item.id);
}
