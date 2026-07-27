import assert from "node:assert/strict";
import test from "node:test";
import {
  canCloseAttendanceRegister,
  validateAttendanceDeterminationDraft,
  validateAttendanceObservationDraft,
  validateSupplementalParticipantDraft,
} from "../app/services/attendance-service.ts";

const approvedDeterminations = [
  "present",
  "absent",
  "excused_absence",
  "unable_to_determine",
];

test("D3 accepts exactly the four lightweight attendance determinations", () => {
  for (const determination of approvedDeterminations) {
    assert.deepEqual(
      validateAttendanceDeterminationDraft({
        determination,
        reason: "现场核对并记录",
        evidenceObservationIds: ["observation-1"],
      }),
      [],
    );
  }

  assert.deepEqual(
    validateAttendanceDeterminationDraft({
      determination: "late",
      reason: "不应成为 D3 判定",
      evidenceObservationIds: ["observation-1"],
    }),
    ["出勤判定必须是出席、缺席、获准缺席或无法判断。"],
  );
});

test("an empty observation list explicitly requests one atomic Manual Witness", () => {
  assert.deepEqual(
    validateAttendanceDeterminationDraft({
      determination: "absent",
      reason: "现场点名确认未到",
      evidenceObservationIds: [],
    }),
    [],
  );
});

test("D3 rejects HR attendance, scoring, completion and analytical fields", () => {
  for (const forbidden of [
    "lateMinutes",
    "attendanceScore",
    "attendanceRate",
    "reliabilityRating",
    "workHours",
    "shiftId",
    "payrollCode",
    "completion",
    "kpi",
    "health",
    "forecast",
    "risk",
    "aiRecommendation",
  ]) {
    const errors = validateAttendanceDeterminationDraft({
      determination: "present",
      reason: "现场核对并记录",
      evidenceObservationIds: ["observation-1"],
      [forbidden]: forbidden === "lateMinutes" ? 5 : true,
    });
    assert.deepEqual(
      errors,
      ["D3 不接受工时、排班、评分、完成或分析字段。"],
      `${forbidden} must be rejected`,
    );
  }
});

test("a QR check-in remains an observation and cannot claim a determination", () => {
  assert.deepEqual(
    validateAttendanceObservationDraft({
      source: "qr_self_check_in",
      observedAt: "2026-08-01T09:00:00+08:00",
      idempotencyKey: "attempt-1",
    }),
    [],
  );
  assert.deepEqual(
    validateAttendanceObservationDraft({
      source: "qr_self_check_in",
      observedAt: "2026-08-01T09:00:00+08:00",
      idempotencyKey: "attempt-1",
      determination: "present",
    }),
    ["QR 签到只能形成 Observation，不能自动形成 Attendance Determination。"],
  );
});

test("supplemental participants require all four governance facts", () => {
  assert.deepEqual(
    validateSupplementalParticipantDraft({
      employeeId: "employee-1",
      inclusionReason: "现场新增，经场次负责人确认",
      authorizedByUserId: "manager-1",
      affectsRequirementEligibility: true,
      requiresFollowUp: true,
    }),
    [],
  );
  assert.deepEqual(
    validateSupplementalParticipantDraft({
      employeeId: "employee-1",
      inclusionReason: "",
      authorizedByUserId: "",
    }),
    [
      "追加参与人必须说明加入原因。",
      "追加参与人必须记录授权人。",
      "必须明确是否影响培训要求适用性。",
      "必须明确是否需要后续人工复核。",
    ],
  );
});

test("register closure allows unrecorded participants but blocks broken evidence", () => {
  assert.deepEqual(
    canCloseAttendanceRegister({
      unresolvedObservationCount: 0,
      brokenEvidenceCount: 0,
      participantWithoutDeterminationCount: 4,
    }),
    { allowed: true, blockers: [] },
  );

  assert.deepEqual(
    canCloseAttendanceRegister({
      unresolvedObservationCount: 2,
      brokenEvidenceCount: 1,
      participantWithoutDeterminationCount: 4,
    }),
    {
      allowed: false,
      blockers: [
        "仍有 2 条签到或现场观察尚未形成判定。",
        "仍有 1 条出勤判定缺少必要证据链。",
      ],
    },
  );
});
