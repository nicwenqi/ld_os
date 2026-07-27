import type {
  DepartmentTrainingSessionRevisionDraft,
  SessionReadinessState,
  SessionRevisionState,
  TrainingPlanItemDraft,
  TrainingPlanVersionDraft,
  TrainingPlanVersionState,
  TrainingSessionRevisionDraft,
} from "../repositories/contracts/training-operations-repository.ts";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const forbiddenOperationalKeys = new Set([
  "attendance",
  "attendanceRecords",
  "completion",
  "completionEvidence",
  "feedback",
  "kpi",
  "kpiActual",
  "forecast",
  "risk",
  "riskScore",
  "health",
  "healthScore",
  "intervention",
  "aiRecommendation",
]);

function textMissing(value: unknown) {
  return typeof value !== "string" || value.trim() === "";
}

function isValidDate(value: unknown) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function isValidDateTime(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

function isValidTimezone(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0;
}

function findForbiddenOperationalKeys(value: unknown, found = new Set<string>()) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenOperationalKeys.has(key)) found.add(key);
    findForbiddenOperationalKeys(child, found);
  }
  return found;
}

function validatePlanItem(item: TrainingPlanItemDraft, index: number) {
  const errors: string[] = [];
  const prefix = `计划项目 ${index + 1}`;

  if (
    item.purposeType === "requirement_delivery" &&
    (
      textMissing(item.requirementVersionId) ||
      textMissing(item.acceptedLearningMethodId)
    )
  ) {
    errors.push(
      `${prefix}：培训要求交付必须引用确切培训要求版本和认可课程方式。`,
    );
  }
  if (
    item.purposeType === "development_delivery" &&
    (
      !textMissing((item as { requirementVersionId?: string }).requirementVersionId) ||
      !textMissing(
        (item as { acceptedLearningMethodId?: string }).acceptedLearningMethodId,
      )
    )
  ) {
    errors.push(`${prefix}：发展性培训不能引用培训要求或认可完成方式。`);
  }
  if (textMissing(item.courseVersionId)) {
    errors.push(`${prefix}：必须引用确切的已发布课程版本。`);
  }
  if (
    !isValidDate(item.deliveryWindowStart) ||
    !isValidDate(item.deliveryWindowEnd) ||
    item.deliveryWindowEnd < item.deliveryWindowStart
  ) {
    errors.push(`${prefix}：交付窗口无效。`);
  }
  if (!positiveInteger(item.plannedSessionCount)) {
    errors.push(`${prefix}：计划场次数必须是大于零的整数。`);
  }
  if (!positiveInteger(item.plannedSeatCapacity)) {
    errors.push(`${prefix}：计划席位容量必须是大于零的整数。`);
  }
  if (textMissing(item.ownerDepartmentId)) {
    errors.push(`${prefix}：必须选择责任部门。`);
  }
  if (
    item.targetDepartments.length === 0 ||
    item.targetDepartments.some(target => textMissing(target.departmentId))
  ) {
    errors.push(`${prefix}：必须选择有效目标部门范围。`);
  }
  return errors;
}

export function validateTrainingPlanVersionDraft(
  draft: TrainingPlanVersionDraft,
) {
  const errors: string[] = [];
  if (textMissing(draft.propertyId)) errors.push("缺少酒店上下文。");
  if (textMissing(draft.code)) errors.push("培训计划代码不能为空。");
  if (textMissing(draft.nameZh)) errors.push("培训计划中文名称不能为空。");
  if (textMissing(draft.purpose)) errors.push("培训计划必须说明业务目的。");
  if (
    !isValidDate(draft.periodStart) ||
    !isValidDate(draft.periodEnd)
  ) {
    errors.push("培训计划期间必须使用有效日期。");
  } else if (draft.periodEnd < draft.periodStart) {
    errors.push("培训计划结束日期不能早于开始日期。");
  }
  if (textMissing(draft.operationalOwnerRoleAssignmentId)) {
    errors.push("培训计划必须指定有效负责人。");
  }
  if (
    textMissing(draft.changeReason) ||
    textMissing(draft.continuityRationale)
  ) {
    errors.push("培训计划版本必须说明变更原因和版本连续性。");
  }
  if (draft.items.length === 0) {
    errors.push("培训计划至少需要一个计划项目。");
  }
  draft.items.forEach((item, index) => {
    errors.push(...validatePlanItem(item, index));
  });
  return errors;
}

function validateVenue(draft: TrainingSessionRevisionDraft) {
  if (draft.venue.type === "approved_venue") {
    return textMissing(draft.venue.venueId)
      ? ["必须选择有效培训地点。"]
      : [];
  }
  if (
    textMissing(draft.venue.locationName) ||
    !draft.venue.capacityAttested
  ) {
    return ["临时培训地点必须说明名称并确认容量。"];
  }
  return [];
}

export function validateTrainingSessionRevisionDraft(
  draft: TrainingSessionRevisionDraft,
) {
  const source = draft as unknown as Record<string, unknown>;
  const errors: string[] = [];
  if (findForbiddenOperationalKeys(source).size > 0) {
    errors.push("D2 不接受出勤、完成、反馈或分析事实。");
  }
  if (Object.prototype.hasOwnProperty.call(source, "mandatory")) {
    errors.push(
      "D2 不使用 mandatory；培训义务必须来自确切 Requirement Version。",
    );
  }
  if (
    typeof source.status === "string" &&
    ["notified", "checkin", "completed", "feedback", "closed"].includes(
      source.status,
    )
  ) {
    errors.push(`D2 不接受 ${source.status} 作为场次状态。`);
  }
  if (textMissing(draft.propertyId)) errors.push("缺少酒店上下文。");
  if (textMissing(draft.code)) errors.push("培训场次代码不能为空。");
  if (textMissing(draft.nameZh)) errors.push("培训场次中文名称不能为空。");
  if (
    draft.purposeType === "requirement_delivery" &&
    (
      textMissing(draft.requirementVersionId) ||
      textMissing(draft.acceptedLearningMethodId)
    )
  ) {
    errors.push("培训要求场次必须引用确切培训要求版本和认可课程方式。");
  }
  if (
    draft.purposeType === "development_delivery" &&
    (
      !textMissing(draft.requirementVersionId) ||
      !textMissing(draft.acceptedLearningMethodId)
    )
  ) {
    errors.push("发展性场次不能声明培训要求或认可完成方式。");
  }
  if (textMissing(draft.courseVersionId)) {
    errors.push("培训场次必须引用确切的已发布课程版本。");
  }
  if (
    textMissing(draft.owningDepartmentId) ||
    textMissing(draft.operationalOwnerRoleAssignmentId)
  ) {
    errors.push("培训场次必须指定责任部门和有效负责人。");
  }
  if (
    !isValidDateTime(draft.startsAt) ||
    !isValidDateTime(draft.endsAt) ||
    new Date(draft.endsAt) <= new Date(draft.startsAt)
  ) {
    errors.push("培训场次必须提供有效且有先后顺序的开始和结束时间。");
  }
  if (!isValidTimezone(draft.timezone)) {
    errors.push("培训场次必须使用有效酒店时区。");
  }
  if (!positiveInteger(draft.capacity)) {
    errors.push("场次容量必须是大于零的整数。");
  }
  if (
    draft.attendancePreparation.opensBeforeMinutes < 0 ||
    draft.attendancePreparation.closesAfterMinutes < 0
  ) {
    errors.push("出勤准备窗口不能是负数。");
  }
  return errors;
}

export function validateDepartmentTrainingSessionRevisionDraft(
  draft: DepartmentTrainingSessionRevisionDraft,
) {
  return validateTrainingSessionRevisionDraft({
    ...draft,
    propertyId: "server-derived",
  });
}

export function readinessForSessionDraft(
  draft: TrainingSessionRevisionDraft,
): {
  state: SessionReadinessState;
  blockers: string[];
  ownerAttestations: string[];
} {
  const blockers = [
    ...validateTrainingSessionRevisionDraft(draft),
    ...validateVenue(draft),
  ];
  if (!draft.trainerAssignments.some(trainer => trainer.role === "lead")) {
    blockers.push("至少需要一名主培训师。");
  }
  if (draft.selectedEmployeeIds.length === 0) {
    blockers.push("发布前必须选择计划参与人。");
  }
  for (const confirmation of draft.ownerConfirmations) {
    if (!confirmation.confirmed) {
      blockers.push(`负责人尚未确认：${confirmation.key}。`);
    }
  }
  return {
    state: blockers.length > 0 ? "incomplete" : "ready_to_publish",
    blockers,
    ownerAttestations: draft.ownerConfirmations
      .filter(confirmation => confirmation.confirmed)
      .map(confirmation => confirmation.key),
  };
}

export function readinessForDepartmentSessionDraft(
  draft: DepartmentTrainingSessionRevisionDraft,
) {
  return readinessForSessionDraft({
    ...draft,
    propertyId: "server-derived",
  });
}

const planTransitions: Record<
  TrainingPlanVersionState,
  TrainingPlanVersionState[]
> = {
  draft: ["review", "withdrawn"],
  review: ["draft", "approved", "withdrawn"],
  approved: ["superseded", "withdrawn"],
  superseded: [],
  withdrawn: [],
};

export function allowedPlanTransition(
  from: TrainingPlanVersionState,
  to: TrainingPlanVersionState,
) {
  return planTransitions[from].includes(to);
}

const sessionTransitions: Record<SessionRevisionState, SessionRevisionState[]> =
  {
    draft: ["published"],
    published: ["superseded"],
    superseded: [],
  };

export function allowedSessionTransition(
  from: SessionRevisionState,
  to: SessionRevisionState,
) {
  return sessionTransitions[from].includes(to);
}
