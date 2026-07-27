import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseTrainingOperationsRepository } from
  "../app/repositories/supabase/training-operations-repository.ts";

function rpcClient(responses = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, parameters = {}) {
      calls.push({ name, parameters });
      const response = responses[name];
      return {
        data: typeof response === "function"
          ? response(parameters)
          : response ?? {},
        error: null,
      };
    },
  };
}

test("manager and department reads use only their authorized projections", async () => {
  const client = rpcClient({
    read_training_operations_foundation: {
      propertyId: "property-1",
      source: "real",
      boundary: { attendance: "unavailable" },
      plans: [],
      sessions: [],
      venues: [],
      trainers: [],
      trainerApprovals: [],
      referenceOptions: {
        courseVersions: [],
        requirementVersions: [],
        departments: [],
        owners: [],
      },
    },
    read_department_training_operations: {
      propertyId: "property-1",
      source: "real",
      boundary: { attendance: "unavailable" },
      scope: [],
      sessions: [],
      referenceOptions: { courseVersions: [], requirements: [] },
    },
  });
  const repository = createSupabaseTrainingOperationsRepository(client);

  await repository.readManagerTrainingOperations("property-1");
  await repository.readDepartmentTrainingOperations();

  assert.deepEqual(client.calls, [
    {
      name: "read_training_operations_foundation",
      parameters: { p_property_id: "property-1" },
    },
    {
      name: "read_department_training_operations",
      parameters: {},
    },
  ]);
});

test("session save translates hotel UI vocabulary without adding later facts", async () => {
  const client = rpcClient({
    save_training_session_revision_draft: {
      id: "revision-1",
      sessionId: "session-1",
      version: 1,
      lifecycleState: "draft",
      source: "real",
    },
  });
  const repository = createSupabaseTrainingOperationsRepository(client);
  const input = {
    propertyId: "property-1",
    expectedVersion: 0,
    code: "SESSION-001",
    nameZh: "消防安全培训",
    purposeType: "development_delivery",
    courseVersionId: "course-version-1",
    owningDepartmentId: "department-1",
    operationalOwnerRoleAssignmentId: "owner-1",
    startsAt: "2026-08-01T09:00:00+08:00",
    endsAt: "2026-08-01T11:00:00+08:00",
    timezone: "Asia/Shanghai",
    capacity: 20,
    venue: {
      type: "other_location",
      locationName: "宴会厅前区",
      capacityAttested: true,
    },
    trainerAssignments: [{
      trainerProfileId: "trainer-1",
      trainerApprovalId: "approval-1",
      role: "co_trainer",
    }],
    targetDepartments: [{
      departmentId: "department-1",
      includeDescendants: true,
    }],
    selectedEmployeeIds: ["employee-1"],
    ownerConfirmations: [
      { key: "materials_ready", confirmed: true },
      { key: "room_setup_ready", confirmed: true },
    ],
    attendancePreparation: {
      mode: "manual_only",
      opensBeforeMinutes: 0,
      closesAfterMinutes: 30,
    },
  };

  const result = await repository.saveSessionRevisionDraft(input);
  assert.equal(result.id, "revision-1");
  assert.equal(result.sessionId, "session-1");
  assert.equal(result.currentState, "draft");
  const payload = client.calls[0].parameters.p_payload;
  assert.deepEqual(payload.venue, {
    type: "other_location",
    nameZh: "宴会厅前区",
    locationDescription: "宴会厅前区",
    capacity: 20,
  });
  assert.equal(payload.trainerAssignments[0].role, "assistant");
  assert.equal("attendance" in payload, false);
  assert.equal("completion" in payload, false);
});

test("participant preview is an explicit zero-write RPC by revision", async () => {
  const client = rpcClient({
    preview_training_session_participants: {
      sessionRevisionId: "revision-1",
      evaluationDate: "2026-08-01",
      source: "real",
      rows: [],
      selectedCount: 0,
      unableToDetermineCount: 0,
      writesPerformed: false,
    },
  });
  const repository = createSupabaseTrainingOperationsRepository(client);
  const result = await repository.previewSessionParticipants({
    propertyId: "property-1",
    sessionRevisionId: "revision-1",
  });

  assert.equal(result.writesPerformed, false);
  assert.deepEqual(client.calls[0], {
    name: "preview_training_session_participants",
    parameters: {
      p_property_id: "property-1",
      p_payload: { sessionRevisionId: "revision-1" },
    },
  });
});

test("department Session writes derive property and scope server-side", async () => {
  const client = rpcClient({
    save_department_training_session_revision_draft: {
      id: "revision-2",
      sessionId: "session-2",
      version: 1,
      lifecycleState: "draft",
      source: "real",
    },
    preview_department_training_session_participants: {
      sessionRevisionId: "revision-2",
      evaluationDate: "2026-08-01",
      source: "real",
      rows: [],
      selectedCount: 0,
      unableToDetermineCount: 0,
      writesPerformed: false,
    },
  });
  const repository = createSupabaseTrainingOperationsRepository(client);
  const input = {
    expectedVersion: 0,
    code: "DEPT-SESSION-001",
    nameZh: "部门发展培训",
    purposeType: "development_delivery",
    courseVersionId: "course-version-1",
    owningDepartmentId: "department-1",
    operationalOwnerRoleAssignmentId: "owner-1",
    startsAt: "2026-08-01T09:00:00+08:00",
    endsAt: "2026-08-01T11:00:00+08:00",
    timezone: "Asia/Shanghai",
    capacity: 20,
    venue: { type: "approved_venue", venueId: "venue-1" },
    trainerAssignments: [],
    targetDepartments: [{
      departmentId: "department-1",
      includeDescendants: true,
    }],
    selectedEmployeeIds: [],
    ownerConfirmations: [],
    attendancePreparation: {
      mode: "manual_only",
      opensBeforeMinutes: 0,
      closesAfterMinutes: 30,
    },
  };

  await repository.saveDepartmentSessionRevisionDraft(input);
  await repository.previewDepartmentSessionParticipants("revision-2");

  assert.deepEqual(client.calls, [
    {
      name: "save_department_training_session_revision_draft",
      parameters: {
        p_payload: {
          ...input,
          venue: input.venue,
          trainerAssignments: [],
        },
        p_expected_version: 0,
      },
    },
    {
      name: "preview_department_training_session_participants",
      parameters: { p_session_revision_id: "revision-2" },
    },
  ]);
  assert.equal("propertyId" in client.calls[0].parameters.p_payload, false);
});

test("venue and trainer saves remain manager-scoped RPC operations", async () => {
  const client = rpcClient({
    save_training_venue: { id: "venue-1", version: 1, source: "real" },
    save_trainer_profile: {
      id: "trainer-1",
      version: 1,
      source: "real",
    },
  });
  const repository = createSupabaseTrainingOperationsRepository(client);

  await repository.saveVenue("property-1", {
    nameZh: "三楼培训室",
    locationDescription: "行政楼三层",
    capacity: 30,
    active: true,
  }, 0);
  await repository.saveTrainer("property-1", {
    type: "external_facilitator",
    displayName: "外聘消防讲师",
    active: true,
    approvals: [],
  }, 0);

  assert.equal(client.calls[0].name, "save_training_venue");
  assert.equal(client.calls[1].name, "save_trainer_profile");
  assert.equal(
    client.calls[1].parameters.p_payload.type,
    "external",
  );
});
