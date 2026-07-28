export type CompletionSourceType =
  | "attendance"
  | "external_evidence"
  | "manager_recognition";

export type CompletionReviewDecision = "accepted" | "rejected";
export type CompletionRecordStatus = "active" | "revoked";

export type CompletionScope = {
  departmentId: string;
  departmentName: string;
  breadcrumb: string[];
  includeDescendants: boolean;
};

export type CompletionReview = {
  id: string;
  decision: CompletionReviewDecision;
  reason: string;
  reviewedAt: string;
};

export type CompletionEvidenceFact = {
  id: string;
  sourceType: CompletionSourceType;
  evidenceDate: string;
  sourceSummary: string;
  employeeId: string;
  employeeFactVersionId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  requirementVersionId: string;
  requirementName: string;
  acceptedLearningMethodId: string;
  acceptedLearningMethodLabel: string;
  methodType:
    | "course_version"
    | "external_certificate"
    | "assessment"
    | "manager_equivalency";
  courseVersionId?: string | null;
  courseVersionName?: string | null;
  recordedAt: string;
  review?: CompletionReview | null;
  completionRecordId?: string | null;
  revoked: boolean;
  revocationReason?: string | null;
  revokedAt?: string | null;
};

export type CompletionRecordFact = {
  id: string;
  completionEvidenceId: string;
  sourceType: CompletionSourceType;
  sourceSummary: string;
  employeeId: string;
  employeeFactVersionId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  requirementVersionId: string;
  requirementName: string;
  acceptedLearningMethodId: string;
  acceptedLearningMethodLabel: string;
  methodType: CompletionEvidenceFact["methodType"];
  courseVersionId?: string | null;
  courseVersionName?: string | null;
  completedOn: string;
  validUntil?: string | null;
  verifiedAt: string;
  supersedesCompletionRecordId?: string | null;
  status: CompletionRecordStatus;
  revocation?: {
    id: string;
    reason: string;
    revokedAt: string;
  } | null;
};

export type AttendanceCompletionCandidate = {
  attendanceDeterminationId: string;
  sessionRevisionId: string;
  sessionName: string;
  sessionCode: string;
  participantSnapshotId: string;
  employeeId: string;
  employeeFactVersionId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
  requirementVersionId: string;
  requirementName: string;
  acceptedLearningMethodId: string;
  acceptedLearningMethodLabel: string;
  courseVersionId: string;
  decidedAt: string;
};

export type CompletionEmployeeOption = {
  id: string;
  employeeNumber: string;
  employeeName: string;
  departmentId?: string | null;
  departmentName?: string | null;
};

export type CompletionMethodOption = {
  requirementVersionId: string;
  requirementName: string;
  requirementState: "effective" | "superseded" | "retired";
  effectiveFrom: string;
  effectiveTo?: string | null;
  id: string;
  label: string;
  methodType: CompletionEvidenceFact["methodType"];
  courseVersionId?: string | null;
  courseVersionName?: string | null;
  certificateType?: string | null;
  issuerCriteria?: string | null;
  evidenceDescription?: string | null;
  validityMonths?: number | null;
  assessmentName?: string | null;
  passCriteria?: string | null;
  approvalStandard?: string | null;
};

export type CompletionWorkspace = {
  propertyId: string;
  propertyName: string;
  role: "manager" | "department";
  source: "real";
  scope: CompletionScope[];
  evidence: CompletionEvidenceFact[];
  records: CompletionRecordFact[];
  attendanceCandidates: AttendanceCompletionCandidate[];
  employees: CompletionEmployeeOption[];
  methods: CompletionMethodOption[];
  boundary: {
    completion: "real";
    assignment: "unavailable";
    feedback: "unavailable";
    kpi: "unavailable";
  };
};

export type AttendanceCompletionEvidenceDraft = {
  attendanceDeterminationId: string;
  sourceSummary: string;
};

export type ExternalCompletionEvidenceDraft = {
  employeeId: string;
  requirementVersionId: string;
  acceptedLearningMethodId: string;
  issuerName: string;
  credentialReference: string;
  issuedOn: string;
  expiresOn?: string;
  sourceSummary: string;
};

export type ManagerRecognitionDraft = {
  employeeId: string;
  requirementVersionId: string;
  acceptedLearningMethodId: string;
  recognitionDate: string;
  recognitionBasis: string;
};

export type CompletionReviewDraft = {
  evidenceId: string;
  decision: CompletionReviewDecision;
  reason: string;
  supersedesCompletionRecordId?: string;
};

export type CompletionRevocationDraft = {
  completionRecordId: string;
  reason: string;
};

export type CompletionMutationResult = {
  id: string;
  factType:
    | "completion_evidence"
    | "completion_evidence_review"
    | "completion_record"
    | "completion_record_revocation";
  source: "real";
  reviewState?: "pending" | "accepted" | "rejected";
  recordStatus?: CompletionRecordStatus;
  completionRecordId?: string;
};

export type CompletionRepository = {
  readManagerWorkspace(propertyId: string): Promise<CompletionWorkspace>;
  readDepartmentWorkspace(): Promise<CompletionWorkspace>;
  recordAttendanceEvidence(
    draft: AttendanceCompletionEvidenceDraft,
  ): Promise<CompletionMutationResult>;
  recordExternalEvidence(
    draft: ExternalCompletionEvidenceDraft,
  ): Promise<CompletionMutationResult>;
  recordManagerRecognition(
    draft: ManagerRecognitionDraft,
  ): Promise<CompletionMutationResult>;
  reviewEvidence(
    draft: CompletionReviewDraft,
  ): Promise<CompletionMutationResult>;
  revokeCompletionRecord(
    draft: CompletionRevocationDraft,
  ): Promise<CompletionMutationResult>;
};
