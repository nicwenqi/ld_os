import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseAttendanceRepository } from
  "../app/repositories/supabase/attendance-repository.ts";

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
      return {
        data: typeof response === "function"
          ? response(parameters)
          : response ?? {},
        error: null,
      };
    },
  };
}

test("manager and department attendance reads use separate authorized projections", async () => {
  const managerWorkspace = {
    propertyId: "property-1",
    propertyName: "苏州酒店",
    source: "real",
    role: "manager",
    registers: [],
    boundary: {
      attendance: "real",
      feedback: "unavailable",
      completion: "unavailable",
      kpi: "unavailable",
    },
  };
  const departmentWorkspace = {
    ...managerWorkspace,
    role: "department",
    scope: [],
  };
  const client = rpcClient({
    read_attendance_workspace: managerWorkspace,
    read_department_attendance_workspace: departmentWorkspace,
  });
  const repository = createSupabaseAttendanceRepository(client);

  assert.equal(
    (await repository.readManagerWorkspace("property-1")).role,
    "manager",
  );
  assert.equal(
    (await repository.readDepartmentWorkspace()).role,
    "department",
  );
  assert.deepEqual(client.calls, [
    {
      name: "read_attendance_workspace",
      parameters: { p_property_id: "property-1" },
    },
    {
      name: "read_department_attendance_workspace",
      parameters: {},
    },
  ]);
});

test("attendance mutations map only to controlled D3 RPCs", async () => {
  const mutation = {
    registerId: "register-1",
    version: 2,
    state: "open",
    source: "real",
  };
  const client = rpcClient({
    open_attendance_register: mutation,
    issue_attendance_checkin_grant: {
      ...mutation,
      token: "one-time-token",
      expiresAt: "2026-08-01T10:00:00+08:00",
    },
    record_attendance_determination: mutation,
    add_supplemental_participant_snapshot: mutation,
    begin_attendance_reconciliation: {
      ...mutation,
      state: "reconciling",
    },
    close_attendance_register: { ...mutation, state: "closed" },
    reopen_attendance_register: mutation,
    submit_attendance_checkin: {
      outcome: "accepted",
      message: "签到 Observation 已接收。",
    },
  });
  const repository = createSupabaseAttendanceRepository(client);

  await repository.openRegister("revision-1", 1);
  await repository.issueCheckInGrant("register-1", 1);
  await repository.recordDetermination({
    registerId: "register-1",
    participantSnapshotId: "participant-1",
    draft: {
      determination: "present",
      reason: "核对二维码回执",
      evidenceObservationIds: ["observation-1"],
    },
    expectedVersion: 2,
  });
  await repository.addSupplementalParticipant({
    registerId: "register-1",
    draft: {
      employeeId: "employee-1",
      inclusionReason: "现场新增，经负责人确认",
      affectsRequirementEligibility: false,
      requiresFollowUp: true,
    },
    expectedVersion: 3,
  });
  await repository.beginReconciliation("register-1", 4);
  await repository.closeRegister("register-1", 5, "证据已核对");
  await repository.reopenRegister("register-1", 6, "收到补充证据");
  await repository.submitPublicCheckIn({
    token: "token",
    employeeNumber: "0001",
    employeeName: "测试员工",
    idempotencyKey: "attempt-1",
  });

  assert.deepEqual(client.calls, [
    {
      name: "open_attendance_register",
      parameters: {
        p_session_revision_id: "revision-1",
        p_expected_version: 1,
      },
    },
    {
      name: "issue_attendance_checkin_grant",
      parameters: {
        p_attendance_register_id: "register-1",
        p_expected_version: 1,
      },
    },
    {
      name: "record_attendance_determination",
      parameters: {
        p_attendance_register_id: "register-1",
        p_participant_snapshot_id: "participant-1",
        p_determination: "present",
        p_reason: "核对二维码回执",
        p_evidence_observation_ids: ["observation-1"],
        p_expected_version: 2,
      },
    },
    {
      name: "add_supplemental_participant_snapshot",
      parameters: {
        p_attendance_register_id: "register-1",
        p_employee_id: "employee-1",
        p_inclusion_reason: "现场新增，经负责人确认",
        p_affects_requirement_eligibility: false,
        p_requires_follow_up: true,
        p_expected_version: 3,
      },
    },
    {
      name: "begin_attendance_reconciliation",
      parameters: {
        p_attendance_register_id: "register-1",
        p_expected_version: 4,
      },
    },
    {
      name: "close_attendance_register",
      parameters: {
        p_attendance_register_id: "register-1",
        p_expected_version: 5,
        p_reason: "证据已核对",
      },
    },
    {
      name: "reopen_attendance_register",
      parameters: {
        p_attendance_register_id: "register-1",
        p_expected_version: 6,
        p_reason: "收到补充证据",
      },
    },
    {
      name: "submit_attendance_checkin",
      parameters: {
        p_token: "token",
        p_employee_number: "0001",
        p_employee_name: "测试员工",
        p_idempotency_key: "attempt-1",
      },
    },
  ]);
});

test("attendance repository preserves business errors from RPCs", async () => {
  const client = rpcClient({
    close_attendance_register:
      new Error("仍有签到或现场观察尚未形成出勤判定。"),
  });
  const repository = createSupabaseAttendanceRepository(client);

  await assert.rejects(
    () => repository.closeRegister("register-1", 3, "完成核对"),
    /仍有签到或现场观察尚未形成出勤判定/,
  );
});

test("attendance repository identifies stale-write conflicts for authoritative reload", async () => {
  const client = rpcClient({
    record_attendance_determination:
      new Error("登记册版本已变化，请重新读取后再操作。"),
  });
  const repository = createSupabaseAttendanceRepository(client);

  await assert.rejects(
    () => repository.recordDetermination({
      registerId: "register-1",
      participantSnapshotId: "participant-1",
      draft: {
        determination: "present",
        reason: "现场核对",
        evidenceObservationIds: [],
      },
      expectedVersion: 2,
    }),
    error => error instanceof Error && error.name === "ConflictError",
  );
});
