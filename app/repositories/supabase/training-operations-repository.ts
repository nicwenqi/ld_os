import type {
  DepartmentTrainingOperationsFoundation,
  DepartmentTrainingSessionRevisionDraft,
  SessionParticipantPreview,
  TrainerProfile,
  TrainingOperationsFoundation,
  TrainingOperationsRepository,
  TrainingSessionRevisionDraft,
  TrainingVenue,
} from "../contracts/training-operations-repository.ts";

type RpcClient = {
  rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function createSupabaseTrainingOperationsRepository(
  client: RpcClient,
): TrainingOperationsRepository {
  return {
    async readManagerTrainingOperations(propertyId) {
      const value = await rpc<TrainingOperationsFoundation>(
        client,
        "read_training_operations_foundation",
        { p_property_id: propertyId },
      );
      return normalizeManagerFoundation(value, propertyId);
    },
    async readDepartmentTrainingOperations() {
      const value = await rpc<DepartmentTrainingOperationsFoundation>(
        client,
        "read_department_training_operations",
        {},
      );
      return {
        ...value,
        referenceOptions: {
          ...value.referenceOptions,
          venues: (value.referenceOptions.venues ?? []).map(venue => ({
            ...venue,
            propertyId: value.propertyId,
          })),
          trainers: (value.referenceOptions.trainers ?? []).map(
            trainer => ({
              ...trainer,
              propertyId: value.propertyId,
              type: (
                trainer.type as string
              ) === "external" ? "external_facilitator" : trainer.type,
            }),
          ),
        },
      };
    },
    savePlanVersionDraft(input) {
      return rpc(client, "save_training_plan_version_draft", {
        p_property_id: input.propertyId,
        p_payload: input,
        p_expected_version: input.expectedVersion,
      });
    },
    transitionPlanVersion(
      planVersionId,
      targetState,
      expectedVersion,
      reason,
    ) {
      return rpc(client, "transition_training_plan_version", {
        p_plan_version_id: planVersionId,
        p_target_state: targetState,
        p_expected_version: expectedVersion,
        p_reason: reason ?? "",
      });
    },
    async saveSessionRevisionDraft(input) {
      const result = await rpc<{
        id: string;
        sessionId: string;
        version: number;
        lifecycleState: "draft";
        source: "real";
      }>(client, "save_training_session_revision_draft", {
        p_property_id: input.propertyId,
        p_payload: sessionPayload(input),
        p_expected_version: input.expectedVersion,
      });
      return {
        ...result,
        currentState: "draft",
      };
    },
    async saveDepartmentSessionRevisionDraft(input) {
      const result = await rpc<{
        id: string;
        sessionId: string;
        version: number;
        lifecycleState: "draft";
        source: "real";
      }>(client, "save_department_training_session_revision_draft", {
        p_payload: sessionPayload(input),
        p_expected_version: input.expectedVersion,
      });
      return {
        ...result,
        currentState: "draft",
      };
    },
    publishSessionRevision(sessionRevisionId, expectedVersion) {
      return rpc(client, "publish_training_session_revision", {
        p_session_revision_id: sessionRevisionId,
        p_expected_version: expectedVersion,
      });
    },
    cancelSession(sessionId, expectedVersion, reason) {
      return rpc(client, "cancel_training_session", {
        p_training_session_id: sessionId,
        p_expected_version: expectedVersion,
        p_reason: reason,
      });
    },
    async previewSessionParticipants(input) {
      const value = await rpc<Record<string, unknown>>(
        client,
        "preview_training_session_participants",
        {
          p_property_id: input.propertyId,
          p_payload: { sessionRevisionId: input.sessionRevisionId },
        },
      );
      return normalizeParticipantPreview(value);
    },
    async previewDepartmentSessionParticipants(sessionRevisionId) {
      const value = await rpc<Record<string, unknown>>(
        client,
        "preview_department_training_session_participants",
        { p_session_revision_id: sessionRevisionId },
      );
      return normalizeParticipantPreview(value);
    },
    async saveVenue(propertyId, input, expectedVersion) {
      const value = await rpc<{
        id: string;
        version: number;
        source: "real";
      }>(client, "save_training_venue", {
        p_property_id: propertyId,
        p_payload: input,
        p_expected_version: expectedVersion,
      });
      return {
        ...input,
        id: value.id,
        propertyId,
        version: value.version,
      } satisfies TrainingVenue;
    },
    async saveTrainer(propertyId, input, expectedVersion) {
      const payload = {
        ...input,
        type: input.type === "external_facilitator"
          ? "external"
          : input.type,
      };
      const value = await rpc<{
        id: string;
        version: number;
        source: "real";
      }>(client, "save_trainer_profile", {
        p_property_id: propertyId,
        p_payload: payload,
        p_expected_version: expectedVersion,
      });
      return {
        id: value.id,
        propertyId,
        type: input.type,
        employeeId: input.employeeId,
        displayName: input.displayName,
        active: input.active,
        version: value.version,
        approvalCount: input.approvals.length,
      } satisfies TrainerProfile;
    },
  };
}

function sessionPayload(
  input: TrainingSessionRevisionDraft | DepartmentTrainingSessionRevisionDraft,
) {
  return {
    ...input,
    venue: input.venue.type === "approved_venue"
      ? input.venue
      : {
          type: "other_location",
          nameZh: input.venue.locationName,
          locationDescription: input.venue.locationName,
          capacity: input.capacity,
        },
    trainerAssignments: input.trainerAssignments.map(assignment => ({
      ...assignment,
      role: assignment.role === "co_trainer"
        ? "assistant"
        : assignment.role,
    })),
  };
}

function normalizeManagerFoundation(
  value: TrainingOperationsFoundation,
  propertyId: string,
): TrainingOperationsFoundation {
  return {
    ...value,
    propertyId,
    trainers: (value.trainers ?? []).map(trainer => ({
      ...trainer,
      propertyId,
      type: (
        trainer.type as string
      ) === "external" ? "external_facilitator" : trainer.type,
    })),
    trainerApprovals: value.trainerApprovals ?? [],
    venues: (value.venues ?? []).map(venue => ({
      ...venue,
      propertyId,
    })),
  };
}

function normalizeParticipantPreview(
  value: Record<string, unknown>,
): SessionParticipantPreview {
  const rows = Array.isArray(value.rows) ? value.rows : [];
  return {
    sessionRevisionId: String(value.sessionRevisionId ?? ""),
    evaluationDate: String(value.evaluationDate ?? ""),
    source: "real",
    rows: rows.map(raw => {
      const row = raw as Record<string, unknown>;
      const evidence = (
        row.evidence && typeof row.evidence === "object"
          ? row.evidence
          : {}
      ) as Record<string, unknown>;
      const result = String(row.result ?? "unable_to_determine");
      const base = {
        employeeId: String(row.employeeId ?? ""),
        employeeNumber: String(row.employeeNumber ?? ""),
        employeeName: String(row.employeeName ?? ""),
        departmentId: row.departmentId
          ? String(row.departmentId)
          : null,
        departmentName: row.departmentName
          ? String(row.departmentName)
          : null,
        employeeFactVersionId: evidence.employeeFactVersionId
          ? String(evidence.employeeFactVersionId)
          : null,
        selected: Boolean(row.selected),
        evaluatedForDate: String(value.evaluationDate ?? ""),
        evidenceReasons: Array.isArray(evidence.missingEvidence)
          ? evidence.missingEvidence.map(String)
          : [],
      };
      if (result === "not_evaluated") {
        return {
          employeeId: base.employeeId,
          employeeFactVersionId: String(
            base.employeeFactVersionId ?? "",
          ),
          selectionState: "selected" as const,
          selected: true as const,
          evaluatedForDate: String(value.evaluationDate ?? ""),
          evidenceReasons: base.evidenceReasons,
          employeeNumber: base.employeeNumber,
          employeeName: base.employeeName,
          departmentId: base.departmentId,
          departmentName: base.departmentName,
        };
      }
      return {
        ...base,
        eligibilityState: result as
          | "eligible"
          | "not_applicable"
          | "unable_to_determine",
      };
    }),
    candidateCount: Number(value.candidateCount ?? rows.length),
    selectedCount: Number(value.selectedCount ?? 0),
    eligibleCount: Number(value.eligibleCount ?? 0),
    notApplicableCount: Number(value.notApplicableCount ?? 0),
    unableToDetermineCount: Number(
      value.unableToDetermineCount ?? 0,
    ),
    writesPerformed: false,
  };
}

async function rpc<T>(
  client: RpcClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, parameters);
  if (error) throw businessError(error.message, `无法完成 ${name}`);
  return data as T;
}

function businessError(message: string, fallback: string) {
  const normalized = message.includes(":")
    ? message.split(":").slice(1).join(":").trim()
    : message;
  const error = new Error(normalized || fallback);
  if (
    /版本已变化|重新读取|并发|stale|conflict|40001/i.test(message)
  ) {
    error.name = "ConflictError";
  }
  return error;
}
