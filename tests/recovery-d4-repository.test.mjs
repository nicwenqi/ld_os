import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseCompletionRepository } from
  "../app/repositories/supabase/completion-repository.ts";

function rpcClient(responses = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, parameters = {}) {
      calls.push({ name, parameters });
      const response = responses[name];
      if (response instanceof Error) {
        return { data: null, error: { message: response.message } };
      }
      return { data: response ?? {}, error: null };
    },
  };
}

test("Manager and Department Completion reads use separate authorized projections", async () => {
  const manager = {
    propertyId: "property-1",
    propertyName: "测试酒店",
    role: "manager",
    source: "real",
    evidence: [],
    records: [],
  };
  const department = {
    ...manager,
    role: "department",
    scope: [],
  };
  const client = rpcClient({
    read_completion_workspace: manager,
    read_department_completion_workspace: department,
  });
  const repository = createSupabaseCompletionRepository(client);

  assert.equal((await repository.readManagerWorkspace("property-1")).role, "manager");
  assert.equal((await repository.readDepartmentWorkspace()).role, "department");
  assert.deepEqual(client.calls, [
    {
      name: "read_completion_workspace",
      parameters: { p_property_id: "property-1" },
    },
    {
      name: "read_department_completion_workspace",
      parameters: {},
    },
  ]);
});

test("D4 mutations map only to controlled Completion RPCs", async () => {
  const result = { id: "fact-1", source: "real" };
  const client = rpcClient({
    record_attendance_completion_evidence: result,
    record_external_completion_evidence: result,
    record_manager_recognition_evidence: result,
    review_completion_evidence: result,
    revoke_completion_record: result,
  });
  const repository = createSupabaseCompletionRepository(client);

  await repository.recordAttendanceEvidence({
    attendanceDeterminationId: "determination-1",
    sourceSummary: "关闭登记册后核对",
  });
  await repository.recordExternalEvidence({
    employeeId: "employee-1",
    requirementVersionId: "requirement-version-1",
    acceptedLearningMethodId: "method-1",
    issuerName: "认可机构",
    credentialReference: "CERT-1",
    issuedOn: "2026-07-01",
    expiresOn: "2027-06-30",
    sourceSummary: "与原件核对",
  });
  await repository.recordManagerRecognition({
    employeeId: "employee-1",
    requirementVersionId: "requirement-version-1",
    acceptedLearningMethodId: "method-2",
    recognitionDate: "2026-07-20",
    recognitionBasis: "符合已批准等价标准",
  });
  await repository.reviewEvidence({
    evidenceId: "evidence-1",
    decision: "accepted",
    reason: "符合完成标准",
    supersedesCompletionRecordId: "record-old",
  });
  await repository.revokeCompletionRecord({
    completionRecordId: "record-1",
    reason: "证书经发证机构确认失效",
  });

  assert.deepEqual(client.calls, [
    {
      name: "record_attendance_completion_evidence",
      parameters: {
        p_attendance_determination_id: "determination-1",
        p_source_summary: "关闭登记册后核对",
      },
    },
    {
      name: "record_external_completion_evidence",
      parameters: {
        p_employee_id: "employee-1",
        p_requirement_version_id: "requirement-version-1",
        p_accepted_learning_method_id: "method-1",
        p_issuer_name: "认可机构",
        p_credential_reference: "CERT-1",
        p_issued_on: "2026-07-01",
        p_expires_on: "2027-06-30",
        p_source_summary: "与原件核对",
      },
    },
    {
      name: "record_manager_recognition_evidence",
      parameters: {
        p_employee_id: "employee-1",
        p_requirement_version_id: "requirement-version-1",
        p_accepted_learning_method_id: "method-2",
        p_recognition_date: "2026-07-20",
        p_recognition_basis: "符合已批准等价标准",
      },
    },
    {
      name: "review_completion_evidence",
      parameters: {
        p_completion_evidence_id: "evidence-1",
        p_decision: "accepted",
        p_reason: "符合完成标准",
        p_supersedes_completion_record_id: "record-old",
      },
    },
    {
      name: "revoke_completion_record",
      parameters: {
        p_completion_record_id: "record-1",
        p_reason: "证书经发证机构确认失效",
      },
    },
  ]);
});

test("D4 repository maps concurrent review and revocation to authoritative conflicts", async () => {
  const client = rpcClient({
    review_completion_evidence:
      new Error("完成证据已被其他用户核验，请重新读取。"),
  });
  const repository = createSupabaseCompletionRepository(client);

  await assert.rejects(
    () => repository.reviewEvidence({
      evidenceId: "evidence-1",
      decision: "accepted",
      reason: "符合标准",
    }),
    error => error instanceof Error && error.name === "ConflictError",
  );
});
