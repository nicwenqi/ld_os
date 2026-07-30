export type EmployeeBaselineState = "full" | "restricted" | "pilot_limited";

export type EmployeeBaselineClassification = {
  state: EmployeeBaselineState;
  departmentId: string | null;
  includeDescendants: boolean;
  limitations: string;
};

export const baselineClassificationLabels: Record<EmployeeBaselineState, string> = {
  full: "Full · 酒店完整基线",
  restricted: "Restricted · 有声明限制",
  pilot_limited: "Pilot Limited · 仅限试运行范围",
};

export function validateEmployeeBaselineClassification(
  draft: EmployeeBaselineClassification,
): EmployeeBaselineClassification {
  const normalized: EmployeeBaselineClassification = {
    state: draft.state,
    departmentId: normalizeOptionalId(draft.departmentId),
    includeDescendants: Boolean(draft.includeDescendants),
    limitations: draft.limitations.trim(),
  };

  if (normalized.state === "full") {
    if (normalized.departmentId || normalized.includeDescendants || normalized.limitations) {
      throw new Error("Full 基线不能限定部门范围或保留限制说明");
    }
    return normalized;
  }

  if (normalized.state === "restricted") {
    if (!normalized.limitations) throw new Error("Restricted 基线必须说明限制");
    if (!normalized.departmentId && normalized.includeDescendants) {
      throw new Error("未选择部门时不能声明包含下级部门");
    }
    return normalized;
  }

  if (normalized.state === "pilot_limited") {
    if (!normalized.departmentId) throw new Error("Pilot Limited 基线必须选择正式部门");
    if (!normalized.limitations) throw new Error("Pilot Limited 基线必须说明限制");
    return normalized;
  }

  throw new Error("员工基线分类无效");
}

function normalizeOptionalId(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
