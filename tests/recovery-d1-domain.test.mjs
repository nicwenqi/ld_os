import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCourseVersionDraft,
  validateRequirementDraft,
} from "../app/services/learning-requirement-service.ts";

const methods = [
  {
    id: "method-course",
    type: "course_version",
    labelZh: "完成已发布消防课程",
    courseVersionId: "course-version-1",
  },
  {
    id: "method-certificate",
    type: "external_certificate",
    labelZh: "提交认可的消防证书",
    certificateType: "消防设施操作员证",
    issuerCriteria: "由国家认可机构签发",
    evidenceDescription: "有效证书扫描件",
    validityMonths: 12,
  },
  {
    id: "method-assessment",
    type: "assessment",
    labelZh: "通过受控消防评估",
    assessmentName: "消防安全知识评估",
    evidenceDescription: "系统验证的考试结果",
    passCriteria: "得分不低于 80 分",
  },
  {
    id: "method-equivalency",
    type: "manager_equivalency",
    labelZh: "经理批准等价认定",
    evidenceDescription: "与本要求能力目标等价的正式证明",
    approvalStandard: "由酒店学习与发展经理核对能力目标和有效期",
  },
];

function validRequirementDraft() {
  return {
    propertyId: "property-1",
    requirementId: undefined,
    requirementVersionId: undefined,
    expectedVersion: 0,
    code: "FIRE-ANNUAL",
    nameZh: "年度消防安全要求",
    nameEn: "Annual Fire Safety Requirement",
    purpose: "确保适用员工掌握酒店消防安全要求。",
    obligationExplanation: "酒店要求适用员工按批准方式满足年度消防安全义务。",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    changeReason: "建立首个批准版本",
    continuityRationale: "酒店年度消防安全义务的首个版本",
    timing: { type: "calendar_recurrence", period: "year" },
    completionDefinition: {
      satisfactionOperator: "any_one",
      methods,
    },
    ruleSets: [
      {
        id: "rule-1",
        effectiveFrom: "2026-01-01",
        effectiveTo: "2026-12-31",
        audienceMode: "all_employees",
        departments: [],
        positionIds: [],
        positionFamilyIds: [],
        newEmployeeCondition: "not_evaluated",
        employmentStatuses: ["active"],
      },
    ],
  };
}

test("D1 keeps the Requirement obligation separate from accepted Course methods", () => {
  const draft = validRequirementDraft();
  assert.equal("courseVersionId" in draft, false);
  assert.deepEqual(
    draft.completionDefinition.methods.map(item => item.type),
    [
      "course_version",
      "external_certificate",
      "assessment",
      "manager_equivalency",
    ],
  );
  assert.deepEqual(validateRequirementDraft(draft), []);
});

test("D1 accepts only the four approved deterministic timing models", () => {
  const approved = [
    { type: "fixed_date", dueDate: "2026-10-31" },
    { type: "hire_relative", dueWithinDays: 30 },
    { type: "calendar_recurrence", period: "quarter" },
    { type: "interval_months", intervalMonths: 12, anchorDate: "2026-01-01" },
  ];

  for (const timing of approved) {
    assert.deepEqual(
      validateRequirementDraft({ ...validRequirementDraft(), timing }),
      [],
    );
  }

  const errors = validateRequirementDraft({
    ...validRequirementDraft(),
    timing: { type: "department_transfer" },
  });
  assert.match(errors[0], /仅支持一次性、入职后、自然周期或固定间隔/);
});

test("overlapping eligibility rule periods block approval in business language", () => {
  const first = validRequirementDraft().ruleSets[0];
  const errors = validateRequirementDraft({
    ...validRequirementDraft(),
    ruleSets: [
      first,
      {
        ...first,
        id: "rule-2",
        effectiveFrom: "2026-06-01",
        effectiveTo: "2027-05-31",
      },
    ],
  });
  assert.match(errors[0], /适用规则有效期重叠/);
});

test("eligibility must name at least one employee status instead of silently matching nobody", () => {
  const draft = validRequirementDraft();
  draft.ruleSets[0].employmentStatuses = [];
  assert.match(
    validateRequirementDraft(draft).join(" "),
    /至少选择一种员工状态/,
  );
});

test("missing eligibility evidence never becomes a false not-applicable rule", () => {
  const draft = validRequirementDraft();
  draft.ruleSets = [
    {
      ...draft.ruleSets[0],
      audienceMode: "structured_scope",
      departments: [
        { departmentId: "department-1", includeDescendants: true },
      ],
    },
  ];
  assert.deepEqual(validateRequirementDraft(draft), []);
  assert.equal(draft.ruleSets[0].departments[0].includeDescendants, true);
});

test("Course Version validation separates content, capability, and continuity identity", () => {
  const valid = {
    propertyId: "property-1",
    courseId: undefined,
    courseVersionId: undefined,
    expectedVersion: 0,
    code: "FIRE-SAFETY",
    nameZh: "消防安全与应急响应",
    nameEn: "Fire Safety and Emergency Response",
    description: "酒店消防安全基础课程。",
    outline: "火灾预防；灭火器使用；疏散流程。",
    learningMaterialVersion: "2026.1",
    standardDurationMinutes: 120,
    learningObjectives: ["正确使用灭火器", "执行酒店疏散流程"],
    capabilityTags: ["消防安全", "应急响应"],
    assessmentCriteria: "完成知识评估和受控实操评估。",
    changeReason: "建立首个课程版本",
    continuityRationale: "首个版本归属于酒店消防安全课程身份",
    impactReviewRequired: false,
    impactNote: "首个版本，不影响历史完成。",
  };

  assert.deepEqual(validateCourseVersionDraft(valid), []);
  assert.match(
    validateCourseVersionDraft({ ...valid, learningObjectives: [] })[0],
    /能力目标/,
  );
  assert.match(
    validateCourseVersionDraft({ ...valid, continuityRationale: "" })[0],
    /版本连续性/,
  );
});

test("completion method subtype fields cannot silently cross method boundaries", () => {
  const draft = validRequirementDraft();
  draft.completionDefinition.methods = [
    {
      ...methods[0],
      certificateType: "不应出现在课程方式",
    },
  ];
  assert.match(
    validateRequirementDraft(draft)[0],
    /课程方式不能包含外部证书、考试或等价认定字段/,
  );
});
