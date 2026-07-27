import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedPlanTransition,
  allowedSessionTransition,
  readinessForSessionDraft,
  validateTrainingPlanVersionDraft,
  validateTrainingSessionRevisionDraft,
} from "../app/services/training-operations-service.ts";

function requirementItem(overrides = {}) {
  return {
    id: "plan-item-1",
    purposeType: "requirement_delivery",
    nameZh: "年度消防安全培训",
    businessPurpose: "在要求有效期内安排年度消防安全课程。",
    deliveryWindowStart: "2026-08-01",
    deliveryWindowEnd: "2026-08-31",
    plannedSessionCount: 2,
    plannedSeatCapacity: 40,
    ownerDepartmentId: "department-1",
    targetDepartments: [
      { departmentId: "department-1", includeDescendants: true },
    ],
    requirementVersionId: "requirement-version-1",
    acceptedLearningMethodId: "accepted-method-1",
    courseVersionId: "course-version-1",
    ...overrides,
  };
}

function validPlan(overrides = {}) {
  return {
    propertyId: "property-1",
    expectedVersion: 0,
    code: "PLAN-2026-Q3",
    nameZh: "2026 年第三季度培训计划",
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    purpose: "确认本季度计划培训容量和交付窗口。",
    operationalOwnerRoleAssignmentId: "role-assignment-manager",
    changeReason: "建立首个计划版本",
    continuityRationale: "首个版本归属于第三季度计划身份",
    items: [requirementItem()],
    ...overrides,
  };
}

function validSession(overrides = {}) {
  return {
    propertyId: "property-1",
    expectedVersion: 0,
    code: "SESSION-2026-001",
    nameZh: "年度消防安全培训·第一场",
    purposeType: "requirement_delivery",
    planItemId: "plan-item-1",
    requirementVersionId: "requirement-version-1",
    acceptedLearningMethodId: "accepted-method-1",
    courseVersionId: "course-version-1",
    owningDepartmentId: "department-1",
    operationalOwnerRoleAssignmentId: "role-assignment-manager",
    startsAt: "2026-08-12T09:00:00+08:00",
    endsAt: "2026-08-12T11:00:00+08:00",
    timezone: "Asia/Shanghai",
    capacity: 24,
    venue: {
      type: "approved_venue",
      venueId: "venue-1",
    },
    trainerAssignments: [
      {
        trainerProfileId: "trainer-1",
        trainerApprovalId: "trainer-approval-1",
        role: "lead",
      },
    ],
    targetDepartments: [
      { departmentId: "department-1", includeDescendants: true },
    ],
    selectedEmployeeIds: ["employee-1", "employee-2"],
    ownerConfirmations: [
      { key: "materials_ready", confirmed: true },
      { key: "room_setup_ready", confirmed: true },
    ],
    attendancePreparation: {
      mode: "qr_or_manual",
      opensBeforeMinutes: 30,
      closesAfterMinutes: 30,
    },
    ...overrides,
  };
}

test("a requirement-delivery plan item requires exact immutable D1 references", () => {
  const errors = validateTrainingPlanVersionDraft(
    validPlan({
      items: [
        requirementItem({
          requirementVersionId: "",
          acceptedLearningMethodId: "",
        }),
      ],
    }),
  );
  assert.deepEqual(errors, [
    "计划项目 1：培训要求交付必须引用确切培训要求版本和认可课程方式。",
  ]);
});

test("development delivery remains explicitly outside the obligation layer", () => {
  const errors = validateTrainingPlanVersionDraft(
    validPlan({
      items: [
        requirementItem({
          purposeType: "development_delivery",
          requirementVersionId: "requirement-version-1",
          acceptedLearningMethodId: "accepted-method-1",
        }),
      ],
    }),
  );
  assert.match(errors.join(" "), /发展性培训不能引用培训要求或认可完成方式/);
});

test("plan capacity and date validation never becomes plan completion logic", () => {
  const errors = validateTrainingPlanVersionDraft(
    validPlan({
      periodStart: "2026-10-01",
      periodEnd: "2026-09-30",
      items: [
        requirementItem({
          plannedSessionCount: 0,
          plannedSeatCapacity: -1,
        }),
      ],
    }),
  );
  assert.match(errors.join(" "), /计划结束日期不能早于开始日期/);
  assert.match(errors.join(" "), /计划场次数必须是大于零的整数/);
  assert.match(errors.join(" "), /计划席位容量必须是大于零的整数/);
  assert.equal(errors.some(error => /完成率|KPI|预测/.test(error)), false);
});

test("D2 rejects attendance, completion, feedback and analytics facts at the service boundary", () => {
  for (const forbidden of [
    "attendance",
    "completionEvidence",
    "feedback",
    "kpiActual",
    "forecast",
    "riskScore",
    "healthScore",
  ]) {
    const errors = validateTrainingSessionRevisionDraft({
      ...validSession(),
      [forbidden]: [],
    });
    assert.match(errors.join(" "), /D2 不接受出勤、完成、反馈或分析事实/);
  }
});

test("a requirement session preserves the exact obligation and course method identity", () => {
  assert.deepEqual(validateTrainingSessionRevisionDraft(validSession()), []);
  assert.match(
    validateTrainingSessionRevisionDraft(
      validSession({ acceptedLearningMethodId: "" }),
    ).join(" "),
    /培训要求场次必须引用确切培训要求版本和认可课程方式/,
  );
});

test("development sessions are selected audiences and never eligibility claims", () => {
  const development = validSession({
    purposeType: "development_delivery",
    planItemId: undefined,
    requirementVersionId: undefined,
    acceptedLearningMethodId: undefined,
  });
  assert.deepEqual(validateTrainingSessionRevisionDraft(development), []);
  assert.equal("eligibilityState" in development, false);
});

test("session readiness separates deterministic evidence from owner attestations", () => {
  assert.deepEqual(readinessForSessionDraft(validSession()), {
    state: "ready_to_publish",
    blockers: [],
    ownerAttestations: ["materials_ready", "room_setup_ready"],
  });

  const result = readinessForSessionDraft(
    validSession({
      venue: { type: "approved_venue", venueId: "" },
      trainerAssignments: [],
      selectedEmployeeIds: [],
      ownerConfirmations: [
        { key: "materials_ready", confirmed: false },
      ],
    }),
  );
  assert.equal(result.state, "incomplete");
  assert.deepEqual(result.blockers, [
    "必须选择有效培训地点。",
    "至少需要一名主培训师。",
    "发布前必须选择计划参与人。",
    "负责人尚未确认：materials_ready。",
  ]);
});

test("version transitions preserve immutable approved and published history", () => {
  assert.equal(allowedPlanTransition("draft", "review"), true);
  assert.equal(allowedPlanTransition("review", "approved"), true);
  assert.equal(allowedPlanTransition("approved", "draft"), false);
  assert.equal(allowedPlanTransition("approved", "superseded"), true);
  assert.equal(allowedSessionTransition("draft", "published"), true);
  assert.equal(allowedSessionTransition("published", "draft"), false);
  assert.equal(allowedSessionTransition("published", "superseded"), true);
});

test("legacy mandatory and delivery-state shortcuts are rejected", () => {
  const errors = validateTrainingSessionRevisionDraft({
    ...validSession(),
    mandatory: true,
    status: "completed",
  });
  assert.match(errors.join(" "), /D2 不使用 mandatory/);
  assert.match(errors.join(" "), /D2 不接受 completed/);
});
