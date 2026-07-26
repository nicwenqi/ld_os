import type {
  AcceptedLearningMethodDraft,
  CourseVersionDraft,
  EligibilityRuleSetDraft,
  RequirementTimingDefinition,
  RequirementVersionDraft,
} from "../repositories/contracts/learning-requirement-repository.ts";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string | undefined) {
  if (!value || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value;
}

function textMissing(value: string | undefined) {
  return !value?.trim();
}

function validateTiming(timing: RequirementTimingDefinition | { type: string }) {
  switch (timing.type) {
    case "fixed_date": {
      const value = timing as Extract<
        RequirementTimingDefinition,
        { type: "fixed_date" }
      >;
      return isValidDate(value.dueDate)
        ? []
        : ["一次性期限必须提供有效到期日。"];
    }
    case "hire_relative": {
      const value = timing as Extract<
        RequirementTimingDefinition,
        { type: "hire_relative" }
      >;
      return Number.isInteger(value.dueWithinDays) && value.dueWithinDays > 0
        ? []
        : ["入职后期限必须是大于零的天数。"];
    }
    case "calendar_recurrence": {
      const value = timing as Extract<
        RequirementTimingDefinition,
        { type: "calendar_recurrence" }
      >;
      return ["month", "quarter", "year"].includes(value.period)
        ? []
        : ["自然周期仅支持月、季度或年度。"];
    }
    case "interval_months": {
      const value = timing as Extract<
        RequirementTimingDefinition,
        { type: "interval_months" }
      >;
      if (
        !Number.isInteger(value.intervalMonths) ||
        value.intervalMonths <= 0 ||
        !isValidDate(value.anchorDate)
      ) {
        return ["固定间隔必须提供大于零的月数和有效锚点日期。"];
      }
      return [];
    }
    default:
      return ["期限规则仅支持一次性、入职后、自然周期或固定间隔。"];
  }
}

function crossSubtypeFields(method: AcceptedLearningMethodDraft) {
  const fields = method as unknown as Record<string, unknown>;
  const subtypeFields = {
    course_version: [
      "certificateType",
      "issuerCriteria",
      "assessmentName",
      "passCriteria",
      "approvalStandard",
      "validityMonths",
    ],
    external_certificate: [
      "courseVersionId",
      "assessmentName",
      "passCriteria",
      "approvalStandard",
    ],
    assessment: [
      "courseVersionId",
      "certificateType",
      "issuerCriteria",
      "validityMonths",
      "approvalStandard",
    ],
    manager_equivalency: [
      "courseVersionId",
      "certificateType",
      "issuerCriteria",
      "validityMonths",
      "assessmentName",
      "passCriteria",
    ],
  } satisfies Record<AcceptedLearningMethodDraft["type"], string[]>;
  return subtypeFields[method.type].filter(field => field in fields);
}

function validateMethod(method: AcceptedLearningMethodDraft, index: number) {
  const prefix = `完成方式 ${index + 1}`;
  const crossFields = crossSubtypeFields(method);
  if (crossFields.length > 0) {
    if (method.type === "course_version") {
      return [`${prefix}：课程方式不能包含外部证书、考试或等价认定字段。`];
    }
    return [`${prefix}：不同完成方式的专属字段不能混用。`];
  }
  if (textMissing(method.labelZh)) return [`${prefix}必须提供业务名称。`];

  switch (method.type) {
    case "course_version":
      return textMissing(method.courseVersionId)
        ? [`${prefix}必须引用一个课程版本。`]
        : [];
    case "external_certificate":
      return [
        method.certificateType,
        method.issuerCriteria,
        method.evidenceDescription,
      ].some(textMissing)
        ? [`${prefix}必须说明证书类型、签发标准和证明材料。`]
        : [];
    case "assessment":
      return [
        method.assessmentName,
        method.evidenceDescription,
        method.passCriteria,
      ].some(textMissing)
        ? [`${prefix}必须说明评估名称、证据和通过标准。`]
        : [];
    case "manager_equivalency":
      return [method.evidenceDescription, method.approvalStandard].some(
          textMissing,
        )
        ? [`${prefix}必须说明等价证据和批准标准。`]
        : [];
  }
}

function periodsOverlap(
  first: EligibilityRuleSetDraft,
  second: EligibilityRuleSetDraft,
) {
  const firstEnd = first.effectiveTo ?? "9999-12-31";
  const secondEnd = second.effectiveTo ?? "9999-12-31";
  return first.effectiveFrom <= secondEnd && second.effectiveFrom <= firstEnd;
}

function validateRuleSet(rule: EligibilityRuleSetDraft, index: number) {
  const errors: string[] = [];
  const prefix = `适用规则 ${index + 1}`;
  if (!isValidDate(rule.effectiveFrom)) {
    errors.push(`${prefix}必须提供有效开始日期。`);
  }
  if (rule.effectiveTo && !isValidDate(rule.effectiveTo)) {
    errors.push(`${prefix}的结束日期无效。`);
  }
  if (
    rule.effectiveTo &&
    isValidDate(rule.effectiveFrom) &&
    rule.effectiveTo < rule.effectiveFrom
  ) {
    errors.push(`${prefix}的结束日期不能早于开始日期。`);
  }
  if (
    rule.audienceMode === "structured_scope" &&
    rule.departments.length === 0 &&
    rule.positionIds.length === 0 &&
    rule.positionFamilyIds.length === 0 &&
    rule.newEmployeeCondition === "not_evaluated" &&
    rule.employmentStatuses.length === 0
  ) {
    errors.push(`${prefix}尚未定义任何适用人群条件。`);
  }
  if (rule.employmentStatuses.length === 0) {
    errors.push(`${prefix}至少选择一种员工状态。`);
  }
  if (
    rule.departments.some(
      department => textMissing(department.departmentId),
    )
  ) {
    errors.push(`${prefix}包含无效部门。`);
  }
  return errors;
}

export function validateCourseVersionDraft(draft: CourseVersionDraft) {
  const errors: string[] = [];
  if (textMissing(draft.propertyId)) errors.push("缺少酒店上下文。");
  if (textMissing(draft.code)) errors.push("课程代码不能为空。");
  if (textMissing(draft.nameZh)) errors.push("课程中文名称不能为空。");
  if ([draft.description, draft.outline, draft.learningMaterialVersion].some(
      textMissing,
    )) {
    errors.push("课程内容身份必须包含描述、大纲和学习材料版本。");
  }
  if (
    !Number.isInteger(draft.standardDurationMinutes) ||
    draft.standardDurationMinutes <= 0
  ) {
    errors.push("标准时长必须是大于零的分钟数。");
  }
  if (draft.learningObjectives.length === 0) {
    errors.push("课程版本至少需要一个能力目标。");
  }
  if (textMissing(draft.assessmentCriteria)) {
    errors.push("课程版本必须说明评估标准。");
  }
  if (textMissing(draft.changeReason)) {
    errors.push("课程版本必须说明变更原因。");
  }
  if (textMissing(draft.continuityRationale)) {
    errors.push("课程版本必须说明版本连续性。");
  }
  if (draft.impactReviewRequired && textMissing(draft.impactNote)) {
    errors.push("需要影响复核时必须说明复核事项。");
  }
  return errors;
}

export function validateRequirementDraft(draft: RequirementVersionDraft) {
  const errors: string[] = [];
  errors.push(...validateTiming(draft.timing));

  for (let first = 0; first < draft.ruleSets.length; first += 1) {
    for (let second = first + 1; second < draft.ruleSets.length; second += 1) {
      if (periodsOverlap(draft.ruleSets[first], draft.ruleSets[second])) {
        errors.push(
          `适用规则有效期重叠：规则 ${first + 1} 与规则 ${second + 1} 会在同一评估日期同时生效，请调整为不重叠期间。`,
        );
      }
    }
  }

  draft.completionDefinition.methods.forEach((method, index) => {
    errors.push(...validateMethod(method, index));
  });
  draft.ruleSets.forEach((rule, index) => {
    errors.push(...validateRuleSet(rule, index));
  });

  if (textMissing(draft.propertyId)) errors.push("缺少酒店上下文。");
  if (textMissing(draft.code)) errors.push("培训要求代码不能为空。");
  if (textMissing(draft.nameZh)) errors.push("培训要求中文名称不能为空。");
  if ([draft.purpose, draft.obligationExplanation].some(textMissing)) {
    errors.push("培训要求必须说明目的和酒店业务义务。");
  }
  if (!isValidDate(draft.effectiveFrom)) {
    errors.push("培训要求版本必须提供有效开始日期。");
  }
  if (
    draft.effectiveTo &&
    (!isValidDate(draft.effectiveTo) ||
      draft.effectiveTo < draft.effectiveFrom)
  ) {
    errors.push("培训要求版本结束日期无效。");
  }
  if ([draft.changeReason, draft.continuityRationale].some(textMissing)) {
    errors.push("培训要求版本必须说明变更原因和义务连续性。");
  }
  if (draft.completionDefinition.satisfactionOperator !== "any_one") {
    errors.push("D1 仅支持完成任一认可方式即满足要求。");
  }
  if (draft.completionDefinition.methods.length === 0) {
    errors.push("培训要求至少需要一个认可完成方式。");
  }
  if (draft.ruleSets.length === 0) {
    errors.push("培训要求至少需要一个有明确有效期的适用规则。");
  }
  return errors;
}
