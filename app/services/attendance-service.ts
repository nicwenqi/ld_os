import type {
  AttendanceDetermination,
  AttendanceDeterminationDraft,
  SupplementalParticipantDraft,
} from "../repositories/contracts/attendance-repository.ts";

const determinationValues = new Set<AttendanceDetermination>([
  "present",
  "absent",
  "excused_absence",
  "unable_to_determine",
]);

const forbiddenFactKeys = new Set([
  "lateMinutes",
  "attendanceScore",
  "attendanceRate",
  "reliabilityRating",
  "workHours",
  "shiftId",
  "payrollCode",
  "completion",
  "completionEvidence",
  "requirementFulfillment",
  "kpi",
  "health",
  "forecast",
  "risk",
  "intervention",
  "aiRecommendation",
]);

export function validateAttendanceDeterminationDraft(
  draft: AttendanceDeterminationDraft & Record<string, unknown>,
): string[] {
  if (containsForbiddenFact(draft)) {
    return ["D3 不接受工时、排班、评分、完成或分析字段。"];
  }
  const errors: string[] = [];
  if (!determinationValues.has(draft.determination)) {
    errors.push("出勤判定必须是出席、缺席、获准缺席或无法判断。");
  }
  if (textMissing(draft.reason)) {
    errors.push("出勤判定必须说明核对原因。");
  }
  if (
    !Array.isArray(draft.evidenceObservationIds)
  ) {
    errors.push("出勤判定必须提供现场证据选择。");
  }
  return errors;
}

export function validateAttendanceObservationDraft(
  draft: Record<string, unknown>,
): string[] {
  if (
    draft.source === "qr_self_check_in" &&
    Object.prototype.hasOwnProperty.call(draft, "determination")
  ) {
    return [
      "QR 签到只能形成 Observation，不能自动形成 Attendance Determination。",
    ];
  }
  const errors: string[] = [];
  if (
    draft.source !== "qr_self_check_in" &&
    draft.source !== "manual_witness"
  ) {
    errors.push("出勤观察来源无效。");
  }
  if (textMissing(draft.observedAt)) {
    errors.push("出勤观察必须记录发生时间。");
  }
  if (textMissing(draft.idempotencyKey)) {
    errors.push("出勤观察必须提供幂等标识。");
  }
  return errors;
}

export function validateSupplementalParticipantDraft(
  draft: Partial<SupplementalParticipantDraft>,
): string[] {
  const errors: string[] = [];
  if (textMissing(draft.inclusionReason)) {
    errors.push("追加参与人必须说明加入原因。");
  }
  if (textMissing(draft.authorizedByUserId)) {
    errors.push("追加参与人必须记录授权人。");
  }
  if (typeof draft.affectsRequirementEligibility !== "boolean") {
    errors.push("必须明确是否影响培训要求适用性。");
  }
  if (typeof draft.requiresFollowUp !== "boolean") {
    errors.push("必须明确是否需要后续人工复核。");
  }
  return errors;
}

export function canCloseAttendanceRegister(_input: {
  unresolvedObservationCount: number;
  brokenEvidenceCount: number;
  participantWithoutDeterminationCount: number;
}): { allowed: boolean; blockers: string[] } {
  const blockers: string[] = [];
  if (_input.unresolvedObservationCount > 0) {
    blockers.push(
      `仍有 ${_input.unresolvedObservationCount} 条签到或现场观察尚未形成判定。`,
    );
  }
  if (_input.brokenEvidenceCount > 0) {
    blockers.push(
      `仍有 ${_input.brokenEvidenceCount} 条出勤判定缺少必要证据链。`,
    );
  }
  return { allowed: blockers.length === 0, blockers };
}

function containsForbiddenFact(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenFactKeys.has(key)) return true;
    if (containsForbiddenFact(child)) return true;
  }
  return false;
}

function textMissing(value: unknown) {
  return typeof value !== "string" || value.trim() === "";
}
