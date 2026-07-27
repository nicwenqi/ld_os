import type {
  AttendanceMutationResult,
  AttendanceRepository,
  AttendanceWorkspace,
} from "../contracts/attendance-repository.ts";

type RpcClient = {
  rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function createSupabaseAttendanceRepository(
  client: RpcClient,
): AttendanceRepository {
  return {
    readManagerWorkspace: propertyId =>
      rpc<AttendanceWorkspace>(client, "read_attendance_workspace", {
        p_property_id: propertyId,
      }),
    readDepartmentWorkspace: () =>
      rpc<AttendanceWorkspace>(
        client,
        "read_department_attendance_workspace",
        {},
      ),
    openRegister: (sessionRevisionId, expectedVersion) =>
      rpc<AttendanceMutationResult>(
        client,
        "open_attendance_register",
        {
          p_session_revision_id: sessionRevisionId,
          p_expected_version: expectedVersion,
        },
      ),
    issueCheckInGrant: (registerId, expectedVersion) =>
      rpc(client, "issue_attendance_checkin_grant", {
        p_attendance_register_id: registerId,
        p_expected_version: expectedVersion,
      }),
    recordDetermination: input =>
      rpc<AttendanceMutationResult>(
        client,
        "record_attendance_determination",
        {
          p_attendance_register_id: input.registerId,
          p_participant_snapshot_id: input.participantSnapshotId,
          p_determination: input.draft.determination,
          p_reason: input.draft.reason,
          p_evidence_observation_ids:
            input.draft.evidenceObservationIds,
          p_expected_version: input.expectedVersion,
        },
      ),
    addSupplementalParticipant: input =>
      rpc<AttendanceMutationResult>(
        client,
        "add_supplemental_participant_snapshot",
        {
          p_attendance_register_id: input.registerId,
          p_employee_id: input.draft.employeeId,
          p_inclusion_reason: input.draft.inclusionReason,
          p_affects_requirement_eligibility:
            input.draft.affectsRequirementEligibility,
          p_requires_follow_up: input.draft.requiresFollowUp,
          p_expected_version: input.expectedVersion,
        },
      ),
    beginReconciliation: (registerId, expectedVersion) =>
      rpc<AttendanceMutationResult>(
        client,
        "begin_attendance_reconciliation",
        {
          p_attendance_register_id: registerId,
          p_expected_version: expectedVersion,
        },
      ),
    closeRegister: (registerId, expectedVersion, reason) =>
      rpc<AttendanceMutationResult>(
        client,
        "close_attendance_register",
        {
          p_attendance_register_id: registerId,
          p_expected_version: expectedVersion,
          p_reason: reason,
        },
      ),
    reopenRegister: (registerId, expectedVersion, reason) =>
      rpc<AttendanceMutationResult>(
        client,
        "reopen_attendance_register",
        {
          p_attendance_register_id: registerId,
          p_expected_version: expectedVersion,
          p_reason: reason,
        },
      ),
    submitPublicCheckIn: input =>
      rpc(client, "submit_attendance_checkin", {
        p_token: input.token,
        p_employee_number: input.employeeNumber,
        p_employee_name: input.employeeName,
        p_idempotency_key: input.idempotencyKey,
      }),
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
      /版本已变化|重新读取|并发|stale|conflict|40001/i.test(error.message)
        ? "ConflictError"
        : "AttendanceRepositoryError";
    throw businessError;
  }
  return data as T;
}
