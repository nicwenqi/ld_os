import type { EligibilityState } from "./learning-requirement-repository.ts";

export type TrainingPlanVersionState =
  | "draft"
  | "review"
  | "approved"
  | "superseded"
  | "withdrawn";

export type SessionRevisionState = "draft" | "published" | "superseded";
export type SessionCurrentState = "draft" | "published" | "cancelled";
export type PlanItemPurpose =
  | "requirement_delivery"
  | "development_delivery";
export type SessionReadinessState =
  | "incomplete"
  | "conflict"
  | "ready_to_publish"
  | "needs_review"
  | "unable_to_determine";

export type TargetDepartment = {
  departmentId: string;
  includeDescendants: boolean;
};

type PlanItemBase = {
  id?: string;
  nameZh: string;
  businessPurpose: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  plannedSessionCount: number;
  plannedSeatCapacity: number;
  ownerDepartmentId: string;
  targetDepartments: TargetDepartment[];
};

export type RequirementDeliveryPlanItemDraft = PlanItemBase & {
  purposeType: "requirement_delivery";
  requirementVersionId: string;
  acceptedLearningMethodId: string;
  courseVersionId: string;
};

export type DevelopmentDeliveryPlanItemDraft = PlanItemBase & {
  purposeType: "development_delivery";
  requirementVersionId?: never;
  acceptedLearningMethodId?: never;
  courseVersionId: string;
};

export type TrainingPlanItemDraft =
  | RequirementDeliveryPlanItemDraft
  | DevelopmentDeliveryPlanItemDraft;

export type TrainingPlanVersionDraft = {
  propertyId: string;
  planId?: string;
  planVersionId?: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  periodStart: string;
  periodEnd: string;
  purpose: string;
  operationalOwnerRoleAssignmentId: string;
  changeReason: string;
  continuityRationale: string;
  items: TrainingPlanItemDraft[];
};

export type TrainingPlanVersion = TrainingPlanVersionDraft & {
  id: string;
  planId: string;
  identityVersion: number;
  versionNumber: number;
  lifecycleState: TrainingPlanVersionState;
  createdAt: string;
  updatedAt: string;
};

export type ApprovedVenueSelection = {
  type: "approved_venue";
  venueId: string;
};

export type OtherVenueSelection = {
  type: "other_location";
  locationName: string;
  capacityAttested: boolean;
};

export type SessionVenueSelection =
  | ApprovedVenueSelection
  | OtherVenueSelection;

export type TrainerAssignmentDraft = {
  trainerProfileId: string;
  trainerApprovalId: string;
  role: "lead" | "co_trainer";
};

export type ResourceConfirmationDraft = {
  key: "materials_ready" | "room_setup_ready" | "equipment_ready";
  confirmed: boolean;
};

export type AttendancePreparationDraft = {
  mode: "qr_or_manual" | "manual_only";
  opensBeforeMinutes: number;
  closesAfterMinutes: number;
};

export type TrainingSessionRevisionDraft = {
  propertyId: string;
  sessionId?: string;
  sessionRevisionId?: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  purposeType: PlanItemPurpose;
  planItemId?: string;
  requirementVersionId?: string;
  acceptedLearningMethodId?: string;
  courseVersionId: string;
  owningDepartmentId: string;
  operationalOwnerRoleAssignmentId: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  capacity: number;
  venue: SessionVenueSelection;
  trainerAssignments: TrainerAssignmentDraft[];
  targetDepartments: TargetDepartment[];
  selectedEmployeeIds: string[];
  ownerConfirmations: ResourceConfirmationDraft[];
  attendancePreparation: AttendancePreparationDraft;
};

export type DepartmentTrainingSessionRevisionDraft = Omit<
  TrainingSessionRevisionDraft,
  "propertyId"
>;

export type TrainingSessionRevision = TrainingSessionRevisionDraft & {
  id: string;
  sessionId: string;
  identityVersion: number;
  revisionNumber: number;
  lifecycleState: SessionRevisionState;
  currentState: SessionCurrentState;
  readinessState: SessionReadinessState;
  createdAt: string;
  updatedAt: string;
};

export type EligibilityCandidateSnapshot = {
  employeeId: string;
  employeeFactVersionId: string | null;
  eligibilityState: EligibilityState;
  selected: boolean;
  evaluatedForDate: string;
  capturedAt?: string;
  evidenceReasons: string[];
};

export type DevelopmentParticipantSnapshot = {
  employeeId: string;
  employeeFactVersionId: string;
  selectionState: "selected";
  selected: true;
  evaluatedForDate: string;
  evidenceReasons: string[];
  capturedAt?: string;
};

export type ParticipantSnapshot =
  | EligibilityCandidateSnapshot
  | DevelopmentParticipantSnapshot;

export type SessionParticipantPreview = {
  sessionRevisionId?: string;
  evaluationDate: string;
  source: "real";
  rows: (ParticipantSnapshot & {
    employeeNumber?: string;
    employeeName?: string;
    departmentId?: string | null;
    departmentName?: string | null;
  })[];
  candidateCount?: number;
  selectedCount: number;
  eligibleCount?: number;
  notApplicableCount?: number;
  unableToDetermineCount: number;
  writesPerformed: false;
};

export type TrainerProfile = {
  id: string;
  propertyId: string;
  type: "internal_employee" | "external_facilitator";
  employeeId?: string;
  displayName: string;
  organizationName?: string;
  active: boolean;
  version: number;
  approvalCount?: number;
};

export type TrainerCourseApproval = {
  id: string;
  trainerProfileId: string;
  courseVersionId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  evidenceNote: string;
  approvedBy: string;
};

export type TrainingVenue = {
  id: string;
  propertyId: string;
  nameZh: string;
  locationDescription: string;
  capacity: number;
  active: boolean;
  version: number;
};

export type TrainingPlanSummary = {
  id: string;
  planId: string;
  identityVersion: number;
  code: string;
  nameZh: string;
  versionNumber: number;
  version: number;
  lifecycleState: TrainingPlanVersionState;
  periodStart: string;
  periodEnd: string;
  purpose: string;
  operationalOwnerRoleAssignmentId: string;
  itemCount: number;
  items: TrainingPlanItemDraft[];
  approvedAt?: string | null;
  updatedAt: string;
};

export type TrainingSessionSummary = {
  id: string;
  revisionId: string;
  code: string;
  nameZh: string;
  purposeType: PlanItemPurpose;
  currentState: SessionCurrentState;
  lifecycleState: SessionRevisionState;
  version: number;
  revisionVersion: number;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  capacity: number;
  owningDepartmentId: string;
  owningDepartmentName: string;
  venueName: string;
  selectedCount: number;
  publishedAt?: string | null;
  readiness?: {
    trainerReady: boolean;
    resourceReady: boolean;
    participantPreviewRequired: boolean;
    attendancePreparationReady: boolean;
  };
  details: {
    planItemId?: string | null;
    requirementVersionId?: string | null;
    acceptedLearningMethodId?: string | null;
    courseVersionId: string;
    operationalOwnerRoleAssignmentId: string;
    venue: SessionVenueSelection;
    trainerAssignments: TrainerAssignmentDraft[];
    targetDepartments: TargetDepartment[];
    selectedEmployeeIds: string[];
    ownerConfirmations: ResourceConfirmationDraft[];
    attendancePreparation: AttendancePreparationDraft;
  };
};

export type TrainingOperationsBoundary = {
  planning: string;
  sessionReadiness: string;
  participantSnapshots: string;
  attendance: "unavailable";
  completion: "unavailable";
  feedback: "unavailable";
  kpi: "unavailable";
};

export type TrainingReferenceOptions = {
  courseVersions: {
    id: string;
    courseId?: string;
    nameZh: string;
    versionNumber: number;
    durationMinutes: number;
  }[];
  requirementVersions: {
    id: string;
    requirementId: string;
    nameZh: string;
    versionNumber: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
    acceptedMethods: {
      id: string;
      labelZh: string;
      methodType: string;
      courseVersionId?: string | null;
    }[];
  }[];
  departments: {
    id: string;
    nameZh: string;
    parentId?: string | null;
    depth: number;
  }[];
  owners: {
    roleAssignmentId: string;
    userId: string;
    displayName: string;
    roleCode: string;
    roleNameZh: string;
  }[];
};

export type TrainingOperationsFoundation = {
  propertyId: string;
  source: "real";
  boundary: TrainingOperationsBoundary;
  plans: TrainingPlanSummary[];
  sessions: TrainingSessionSummary[];
  trainers: TrainerProfile[];
  trainerApprovals: TrainerCourseApproval[];
  venues: TrainingVenue[];
  referenceOptions: TrainingReferenceOptions;
};

export type DepartmentTrainingOperationsFoundation = {
  propertyId: string;
  source: "real";
  boundary: TrainingOperationsBoundary;
  scope: {
    departmentId: string;
    departmentName: string;
    includeDescendants: boolean;
    breadcrumb?: string[];
  }[];
  sessions: TrainingSessionSummary[];
  participantCandidates: {
    employeeId: string;
    employeeNumber: string;
    employeeName: string;
    departmentId: string;
    departmentName: string;
  }[];
  referenceOptions: {
    courseVersions: TrainingReferenceOptions["courseVersions"];
    requirements: {
      id: string;
      nameZh: string;
      versionNumber: number;
      acceptedMethods: {
        id: string;
        labelZh: string;
        methodType: string;
        courseVersionId?: string | null;
      }[];
    }[];
    departments: TrainingReferenceOptions["departments"];
    owners: TrainingReferenceOptions["owners"];
    venues: TrainingVenue[];
    trainers: TrainerProfile[];
    trainerApprovals: TrainerCourseApproval[];
  };
};

export type TrainingVenueDraft = Omit<
  TrainingVenue,
  "id" | "propertyId" | "version"
> & { id?: string };

export type TrainerProfileDraft = {
  id?: string;
  type: TrainerProfile["type"];
  employeeId?: string;
  displayName: string;
  active: boolean;
  approvals: {
    courseVersionId: string;
    effectiveFrom: string;
    effectiveTo?: string;
    evidenceNote: string;
  }[];
};

export type TrainingPlanMutationResult = {
  id: string;
  planId: string;
  version: number;
  lifecycleState: TrainingPlanVersionState;
  source: "real";
};

export type TrainingSessionMutationResult = {
  id: string;
  sessionId?: string;
  version: number;
  lifecycleState?: SessionRevisionState;
  currentState?: SessionCurrentState;
  participantSnapshotCount?: number;
  source: "real";
};

export interface TrainingOperationsRepository {
  readManagerTrainingOperations(
    propertyId: string,
  ): Promise<TrainingOperationsFoundation>;
  readDepartmentTrainingOperations(): Promise<DepartmentTrainingOperationsFoundation>;
  savePlanVersionDraft(
    input: TrainingPlanVersionDraft,
  ): Promise<TrainingPlanMutationResult>;
  transitionPlanVersion(
    planVersionId: string,
    targetState: TrainingPlanVersionState,
    expectedVersion: number,
    reason?: string,
  ): Promise<TrainingPlanMutationResult>;
  saveSessionRevisionDraft(
    input: TrainingSessionRevisionDraft,
  ): Promise<TrainingSessionMutationResult>;
  saveDepartmentSessionRevisionDraft(
    input: DepartmentTrainingSessionRevisionDraft,
  ): Promise<TrainingSessionMutationResult>;
  publishSessionRevision(
    sessionRevisionId: string,
    expectedVersion: number,
  ): Promise<TrainingSessionMutationResult>;
  cancelSession(
    sessionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<TrainingSessionMutationResult>;
  previewSessionParticipants(
    input: {
      propertyId: string;
      sessionRevisionId: string;
    },
  ): Promise<SessionParticipantPreview>;
  previewDepartmentSessionParticipants(
    sessionRevisionId: string,
  ): Promise<SessionParticipantPreview>;
  saveVenue(
    propertyId: string,
    input: TrainingVenueDraft,
    expectedVersion: number,
  ): Promise<TrainingVenue>;
  saveTrainer(
    propertyId: string,
    input: TrainerProfileDraft,
    expectedVersion: number,
  ): Promise<TrainerProfile>;
}
