import type {
  CompletionReviewDecision,
} from "../repositories/contracts/completion-repository.ts";

const forbiddenFactKeys = new Set([
  "assignment",
  "dueDateTask",
  "reminder",
  "notification",
  "feedback",
  "survey",
  "kpi",
  "health",
  "forecast",
  "risk",
  "aiRecommendation",
  "performanceRating",
]);

export function validateCompletionEvidenceDraft(
  draft: Record<string, unknown>,
): string[] {
  if (containsForbiddenFact(draft)) {
    return ["D4 不接受任务、提醒、反馈、分析或员工绩效字段。"];
  }

  if (draft.sourceType === "attendance") {
    if (
      draft.attendanceDetermination !== undefined &&
      draft.attendanceDetermination !== "present"
    ) {
      return [
        "只有已核对为出席的 Attendance Determination 可以提交为完成证据。",
      ];
    }
    return required([
      [draft.attendanceDeterminationId, "请选择已核对的出席判定。"],
      [draft.sourceSummary, "请说明出勤证据的核对情况。"],
    ]);
  }

  if (draft.sourceType === "external_evidence") {
    const errors = required([
      [draft.employeeId, "请选择员工。"],
      [draft.requirementVersionId, "请选择培训要求版本。"],
      [draft.acceptedLearningMethodId, "请选择认可的完成方式。"],
      [draft.issuerName, "请填写发证机构。"],
      [draft.credentialReference, "请填写证书或凭证编号。"],
      [draft.issuedOn, "请选择证据发生日期。"],
      [draft.sourceSummary, "请说明证据来源与核对情况。"],
    ]);
    if (
      !textMissing(draft.issuedOn) &&
      !textMissing(draft.expiresOn) &&
      String(draft.expiresOn) < String(draft.issuedOn)
    ) {
      errors.push("证书有效期不能早于发证日期。");
    }
    return errors;
  }

  if (draft.sourceType === "manager_recognition") {
    return required([
      [draft.employeeId, "请选择员工。"],
      [draft.requirementVersionId, "请选择培训要求版本。"],
      [draft.acceptedLearningMethodId, "请选择认可的完成方式。"],
      [draft.recognitionDate, "请选择认定日期。"],
      [draft.recognitionBasis, "请填写经理等价认定依据。"],
    ]);
  }

  return ["请选择 D4 支持的完成证据来源。"];
}

export function validateCompletionReviewDraft(draft: {
  decision: CompletionReviewDecision | string;
  reason: string;
}): string[] {
  const errors: string[] = [];
  if (draft.decision !== "accepted" && draft.decision !== "rejected") {
    errors.push("请选择接受或拒绝。");
  }
  if (textMissing(draft.reason)) {
    errors.push("核验决定必须说明原因。");
  }
  return errors;
}

export function validateCompletionRevocationDraft(draft: {
  reason: string;
}): string[] {
  return textMissing(draft.reason)
    ? ["撤销必须说明原因，原完成记录和证据将被永久保留。"]
    : [];
}

function required(
  entries: [unknown, string][],
): string[] {
  return entries.flatMap(([value, message]) =>
    textMissing(value) ? [message] : []
  );
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
