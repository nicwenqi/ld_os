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
  capturedAt?: string;
};

export type ParticipantSnapshot =
  | EligibilityCandidateSnapshot
  | DevelopmentParticipantSnapshot;

export type SessionParticipantPreview = {
  sessionRevisionId?: string;
  evaluationDate: string;
  source: "real" | "local_review";
  rows: ParticipantSnapshot[];
  selectedCount: number;
  unableToDetermineCount: number;
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

export type TrainingOperationsFoundation = {
  propertyId: string;
  source: "real" | "local_review";
  plans: TrainingPlanVersion[];
  sessions: TrainingSessionRevision[];
  trainers: TrainerProfile[];
  trainerApprovals: TrainerCourseApproval[];
  venues: TrainingVenue[];
};

export type DepartmentTrainingOperationsFoundation = {
  propertyId: string;
  source: "real" | "local_review";
  scope: {
    departmentId: string;
    departmentName: string;
    includeDescendants: boolean;
  }[];
  approvedPlans: TrainingPlanVersion[];
  sessions: TrainingSessionRevision[];
  selectableTrainers: TrainerProfile[];
  selectableVenues: TrainingVenue[];
};

export interface TrainingOperationsRepository {
  readManagerTrainingOperations(
    propertyId: string,
  ): Promise<TrainingOperationsFoundation>;
  readDepartmentTrainingOperations(): Promise<DepartmentTrainingOperationsFoundation>;
  savePlanVersionDraft(
    input: TrainingPlanVersionDraft,
  ): Promise<TrainingPlanVersion>;
  transitionPlanVersion(
    planVersionId: string,
    targetState: TrainingPlanVersionState,
    expectedVersion: number,
    reason?: string,
  ): Promise<TrainingPlanVersion>;
  saveSessionRevisionDraft(
    input: TrainingSessionRevisionDraft,
  ): Promise<TrainingSessionRevision>;
  publishSessionRevision(
    sessionRevisionId: string,
    expectedVersion: number,
  ): Promise<TrainingSessionRevision>;
  cancelSession(
    sessionId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<TrainingSessionRevision>;
  previewSessionParticipants(
    input: TrainingSessionRevisionDraft,
  ): Promise<SessionParticipantPreview>;
}
