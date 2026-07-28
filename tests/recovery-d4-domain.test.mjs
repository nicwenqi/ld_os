import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCompletionEvidenceDraft,
  validateCompletionReviewDraft,
  validateCompletionRevocationDraft,
} from "../app/services/completion-service.ts";

test("Attendance remains source evidence and only Present can be proposed", () => {
  assert.deepEqual(
    validateCompletionEvidenceDraft({
      sourceType: "attendance",
      attendanceDeterminationId: "determination-1",
      attendanceDetermination: "present",
      sourceSummary: "已核对关闭登记册中的出席判定",
    }),
    [],
  );

  for (const determination of [
    "absent",
    "excused_absence",
    "unable_to_determine",
  ]) {
    assert.deepEqual(
      validateCompletionEvidenceDraft({
        sourceType: "attendance",
        attendanceDeterminationId: "determination-1",
        attendanceDetermination: determination,
        sourceSummary: "不应形成完成证据",
      }),
      ["只有已核对为出席的 Attendance Determination 可以提交为完成证据。"],
      determination,
    );
  }
});

test("external evidence requires its approved business evidence fields", () => {
  assert.deepEqual(
    validateCompletionEvidenceDraft({
      sourceType: "external_evidence",
      employeeId: "employee-1",
      requirementVersionId: "requirement-version-1",
      acceptedLearningMethodId: "method-1",
      issuerName: "认可发证机构",
      credentialReference: "CERT-2026-001",
      issuedOn: "2026-07-01",
      expiresOn: "2027-06-30",
      sourceSummary: "外部证书信息已与原件核对",
    }),
    [],
  );

  assert.deepEqual(
    validateCompletionEvidenceDraft({
      sourceType: "external_evidence",
      employeeId: "",
      requirementVersionId: "",
      acceptedLearningMethodId: "",
      issuerName: "",
      credentialReference: "",
      issuedOn: "",
      expiresOn: "2026-01-01",
      sourceSummary: "",
    }),
    [
      "请选择员工。",
      "请选择培训要求版本。",
      "请选择认可的完成方式。",
      "请填写发证机构。",
      "请填写证书或凭证编号。",
      "请选择证据发生日期。",
      "请说明证据来源与核对情况。",
    ],
  );
});

test("Manager Recognition requires an explicit approved basis", () => {
  assert.deepEqual(
    validateCompletionEvidenceDraft({
      sourceType: "manager_recognition",
      employeeId: "employee-1",
      requirementVersionId: "requirement-version-1",
      acceptedLearningMethodId: "method-1",
      recognitionDate: "2026-07-20",
      recognitionBasis: "依据经批准的等价认定标准核对外部经历",
    }),
    [],
  );
  assert.match(
    validateCompletionEvidenceDraft({
      sourceType: "manager_recognition",
      employeeId: "employee-1",
      requirementVersionId: "requirement-version-1",
      acceptedLearningMethodId: "method-1",
      recognitionDate: "",
      recognitionBasis: "",
    }).join(" "),
    /认定日期.*认定依据/,
  );
});

test("D4 rejects Assignment, reminders, analytics and employee-performance facts", () => {
  for (const forbiddenKey of [
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
  ]) {
    assert.deepEqual(
      validateCompletionEvidenceDraft({
        sourceType: "attendance",
        attendanceDeterminationId: "determination-1",
        attendanceDetermination: "present",
        sourceSummary: "已核对",
        [forbiddenKey]: true,
      }),
      ["D4 不接受任务、提醒、反馈、分析或员工绩效字段。"],
      forbiddenKey,
    );
  }
});

test("evidence review and revocation are explicit reasoned decisions", () => {
  assert.deepEqual(
    validateCompletionReviewDraft({
      decision: "accepted",
      reason: "证据符合该版本完成方式标准",
    }),
    [],
  );
  assert.deepEqual(
    validateCompletionReviewDraft({
      decision: "unknown",
      reason: "",
    }),
    ["请选择接受或拒绝。", "核验决定必须说明原因。"],
  );
  assert.deepEqual(
    validateCompletionRevocationDraft({ reason: "" }),
    ["撤销必须说明原因，原完成记录和证据将被永久保留。"],
  );
});
