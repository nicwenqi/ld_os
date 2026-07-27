export type AttendanceDetermination =
  | "present"
  | "absent"
  | "excused_absence"
  | "unable_to_determine";

export type AttendanceRegisterState =
  | "open"
  | "reconciling"
  | "closed";

export type AttendanceObservationSource =
  | "qr_self_check_in"
  | "manual_witness";

export type AttendanceObservation = {
  id: string;
  source: AttendanceObservationSource;
  observedAt: string;
  receivedAt: string;
  requiresReview: boolean;
  evidenceType: "qr_server_receipt" | "manual_witness";
};

export type AttendanceDeterminationFact = {
  id: string;
  determination: AttendanceDetermination;
  reason: string;
  decidedAt: string;
  decidedByName?: string | null;
  supersedesId?: string | null;
  evidenceObservationIds: string[];
};

export type AttendanceParticipant = {
  participantSnapshotId: string;
  snapshotOrigin: "published_roster" | "supplemental";
  employeeFactVersionId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  eligibilityState:
    | "eligible"
    | "not_applicable"
    | "unable_to_determine"
    | "not_evaluated";
  observations: AttendanceObservation[];
  currentDetermination?: AttendanceDeterminationFact | null;
  needsReview: boolean;
  inclusionReason?: string | null;
  affectsRequirementEligibility?: boolean | null;
  requiresFollowUp?: boolean | null;
};

export type AttendanceRegisterSummary = {
  id?: string | null;
  sessionId: string;
  sessionRevisionId: string;
  sessionName: string;
  sessionCode: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  owningDepartmentId: string;
  owningDepartmentName: string;
  operationalOwnerRoleAssignmentId: string;
  preparationMode: "manual_only" | "qr_or_manual";
  state: AttendanceRegisterState | "prepared";
  version: number;
  openedAt?: string | null;
  closedAt?: string | null;
  canManage: boolean;
  canCloseRegister: boolean;
  participants: AttendanceParticipant[];
  counts: {
    participantCount: number;
    observedCount: number;
    determinedCount: number;
    unrecordedCount: number;
    unresolvedObservationCount: number;
    brokenEvidenceCount: number;
  };
};

export type AttendanceWorkspace = {
  propertyId: string;
  propertyName: string;
  source: "real";
  role: "manager" | "department";
  scope?: {
    departmentId: string;
    departmentName: string;
    breadcrumb: string[];
    includeDescendants: boolean;
  }[];
  registers: AttendanceRegisterSummary[];
  boundary: {
    attendance: "real";
    feedback: "unavailable";
    completion: "unavailable";
    kpi: "unavailable";
  };
};

export type AttendanceDeterminationDraft = {
  determination: AttendanceDetermination;
  reason: string;
  evidenceObservationIds: string[];
};

export type SupplementalParticipantDraft = {
  employeeId: string;
  inclusionReason: string;
  authorizedByUserId?: string;
  affectsRequirementEligibility: boolean;
  requiresFollowUp: boolean;
};

export type AttendanceMutationResult = {
  registerId: string;
  version: number;
  state: AttendanceRegisterState;
  source: "real";
};

export type AttendanceRepository = {
  readManagerWorkspace(propertyId: string): Promise<AttendanceWorkspace>;
  readDepartmentWorkspace(): Promise<AttendanceWorkspace>;
  openRegister(
    sessionRevisionId: string,
    expectedVersion: number,
  ): Promise<AttendanceMutationResult>;
  issueCheckInGrant(
    registerId: string,
    expectedVersion: number,
  ): Promise<{
    registerId: string;
    version: number;
    token: string;
    expiresAt: string;
    source: "real";
  }>;
  recordDetermination(input: {
    registerId: string;
    participantSnapshotId: string;
    draft: AttendanceDeterminationDraft;
    expectedVersion: number;
  }): Promise<AttendanceMutationResult>;
  addSupplementalParticipant(input: {
    registerId: string;
    draft: SupplementalParticipantDraft;
    expectedVersion: number;
  }): Promise<AttendanceMutationResult>;
  beginReconciliation(
    registerId: string,
    expectedVersion: number,
  ): Promise<AttendanceMutationResult>;
  closeRegister(
    registerId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<AttendanceMutationResult>;
  reopenRegister(
    registerId: string,
    expectedVersion: number,
    reason: string,
  ): Promise<AttendanceMutationResult>;
  submitPublicCheckIn(input: {
    token: string;
    employeeNumber: string;
    employeeName: string;
    idempotencyKey: string;
  }): Promise<{
    outcome: "accepted" | "already_recorded" | "unable_to_check_in";
    message: string;
  }>;
};
