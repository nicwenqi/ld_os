import type {
  CompletionMutationResult,
  CompletionRepository,
  CompletionWorkspace,
} from "../contracts/completion-repository.ts";

type RpcClient = {
  rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function createSupabaseCompletionRepository(
  client: RpcClient,
): CompletionRepository {
  return {
    readManagerWorkspace: propertyId =>
      rpc<CompletionWorkspace>(client, "read_completion_workspace", {
        p_property_id: propertyId,
      }),
    readDepartmentWorkspace: () =>
      rpc<CompletionWorkspace>(
        client,
        "read_department_completion_workspace",
        {},
      ),
    recordAttendanceEvidence: draft =>
      rpc<CompletionMutationResult>(
        client,
        "record_attendance_completion_evidence",
        {
          p_attendance_determination_id:
            draft.attendanceDeterminationId,
          p_source_summary: draft.sourceSummary,
        },
      ),
    recordExternalEvidence: draft =>
      rpc<CompletionMutationResult>(
        client,
        "record_external_completion_evidence",
        {
          p_employee_id: draft.employeeId,
          p_requirement_version_id: draft.requirementVersionId,
          p_accepted_learning_method_id:
            draft.acceptedLearningMethodId,
          p_issuer_name: draft.issuerName,
          p_credential_reference: draft.credentialReference,
          p_issued_on: draft.issuedOn,
          p_expires_on: draft.expiresOn || null,
          p_source_summary: draft.sourceSummary,
        },
      ),
    recordManagerRecognition: draft =>
      rpc<CompletionMutationResult>(
        client,
        "record_manager_recognition_evidence",
        {
          p_employee_id: draft.employeeId,
          p_requirement_version_id: draft.requirementVersionId,
          p_accepted_learning_method_id:
            draft.acceptedLearningMethodId,
          p_recognition_date: draft.recognitionDate,
          p_recognition_basis: draft.recognitionBasis,
        },
      ),
    reviewEvidence: draft =>
      rpc<CompletionMutationResult>(
        client,
        "review_completion_evidence",
        {
          p_completion_evidence_id: draft.evidenceId,
          p_decision: draft.decision,
          p_reason: draft.reason,
          p_supersedes_completion_record_id:
            draft.supersedesCompletionRecordId || null,
        },
      ),
    revokeCompletionRecord: draft =>
      rpc<CompletionMutationResult>(
        client,
        "revoke_completion_record",
        {
          p_completion_record_id: draft.completionRecordId,
          p_reason: draft.reason,
        },
      ),
  };
}

async function rpc<T>(
  client: RpcClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    const businessError = new Error(error.message || `无法完成 ${name}`);
    businessError.name =
      /已被其他用户|重新读取|已有.*有效|已被撤销|并发|conflict|P0001/i
        .test(error.message)
        ? "ConflictError"
        : "CompletionRepositoryError";
    throw businessError;
  }
  return data as T;
}
