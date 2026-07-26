export type CourseVersionState = "draft" | "review" | "published" | "retired";
export type RequirementVersionState =
  | "draft"
  | "approved"
  | "effective"
  | "superseded"
  | "retired";

export type LearningMethodType =
  | "course_version"
  | "external_certificate"
  | "assessment"
  | "manager_equivalency";

export type EligibilityState =
  | "eligible"
  | "not_applicable"
  | "unable_to_determine";

export type RequirementTimingDefinition =
  | { type: "fixed_date"; dueDate: string }
  | { type: "hire_relative"; dueWithinDays: number }
  | {
      type: "calendar_recurrence";
      period: "month" | "quarter" | "year";
    }
  | {
      type: "interval_months";
      intervalMonths: number;
      anchorDate: string;
    };

export type CourseLearningMethodDraft = {
  id?: string;
  type: "course_version";
  labelZh: string;
  courseVersionId: string;
};

export type ExternalCertificateMethodDraft = {
  id?: string;
  type: "external_certificate";
  labelZh: string;
  certificateType: string;
  issuerCriteria: string;
  evidenceDescription: string;
  validityMonths?: number;
};

export type AssessmentMethodDraft = {
  id?: string;
  type: "assessment";
  labelZh: string;
  assessmentName: string;
  evidenceDescription: string;
  passCriteria: string;
};

export type ManagerEquivalencyMethodDraft = {
  id?: string;
  type: "manager_equivalency";
  labelZh: string;
  evidenceDescription: string;
  approvalStandard: string;
};

export type AcceptedLearningMethodDraft =
  | CourseLearningMethodDraft
  | ExternalCertificateMethodDraft
  | AssessmentMethodDraft
  | ManagerEquivalencyMethodDraft;

export type EligibilityDepartmentRule = {
  departmentId: string;
  includeDescendants: boolean;
};

export type EligibilityRuleSetDraft = {
  id?: string;
  effectiveFrom: string;
  effectiveTo?: string;
  audienceMode: "all_employees" | "structured_scope";
  departments: EligibilityDepartmentRule[];
  positionIds: string[];
  positionFamilyIds: string[];
  newEmployeeCondition: "required" | "excluded" | "not_evaluated";
  employmentStatuses: string[];
};

export type CourseVersionDraft = {
  propertyId: string;
  courseId?: string;
  courseVersionId?: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  description: string;
  outline: string;
  learningMaterialVersion: string;
  standardDurationMinutes: number;
  learningObjectives: string[];
  capabilityTags: string[];
  assessmentCriteria: string;
  changeReason: string;
  continuityRationale: string;
  impactReviewRequired: boolean;
  impactNote?: string;
};

export type RequirementVersionDraft = {
  propertyId: string;
  requirementId?: string;
  requirementVersionId?: string;
  expectedVersion: number;
  code: string;
  nameZh: string;
  nameEn?: string;
  purpose: string;
  obligationExplanation: string;
  effectiveFrom: string;
  effectiveTo?: string;
  changeReason: string;
  continuityRationale: string;
  timing: RequirementTimingDefinition;
  completionDefinition: {
    satisfactionOperator: "any_one";
    methods: AcceptedLearningMethodDraft[];
  };
  ruleSets: EligibilityRuleSetDraft[];
};

export type CourseSummary = {
  id: string;
  propertyId: string;
  code: string;
  nameZh: string;
  nameEn?: string;
  currentVersionId?: string;
  currentVersionState?: CourseVersionState;
  version: number;
};

export type CourseVersion = CourseVersionDraft & {
  id: string;
  courseId: string;
  identityVersion: number;
  versionNumber: number;
  state: CourseVersionState;
  createdAt: string;
  updatedAt: string;
};

export type RequirementSummary = {
  id: string;
  propertyId: string;
  code: string;
  nameZh: string;
  nameEn?: string;
  currentVersionId?: string;
  currentVersionState?: RequirementVersionState;
  version: number;
};

export type RequirementVersion = RequirementVersionDraft & {
  id: string;
  requirementId: string;
  identityVersion: number;
  versionNumber: number;
  state: RequirementVersionState;
  createdAt: string;
  updatedAt: string;
};

export type EligibilityEvidence = {
  employeeFactVersionId: string | null;
  evaluatedAt: string;
  matchedDimensions: string[];
  missingEvidence: string[];
  explanationZh: string;
};

export type EligibilityEvaluation = {
  employeeId: string;
  employeeNumber: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  requirementVersionId: string;
  result: EligibilityState;
  evidence: EligibilityEvidence;
};

export type EligibilityEvaluationPage = {
  rows: EligibilityEvaluation[];
  total: number;
  evaluatedAt: string;
  source: "real" | "local_review";
};

export type LearningRequirementFoundation = {
  propertyId: string;
  source: "real" | "local_review";
  courses: CourseVersion[];
  requirements: RequirementVersion[];
};

export type DepartmentRequirementFoundation = {
  propertyId: string;
  source: "real" | "local_review";
  scope: {
    departmentId: string;
    departmentName: string;
    includeDescendants: boolean;
  }[];
  requirements: RequirementVersion[];
};

export interface LearningRequirementRepository {
  readManagerFoundation(
    propertyId: string,
  ): Promise<LearningRequirementFoundation>;
  readDepartmentRequirements(): Promise<DepartmentRequirementFoundation>;
  listCourses(propertyId: string): Promise<CourseSummary[]>;
  getCourseVersion(courseVersionId: string): Promise<CourseVersion>;
  saveCourseVersionDraft(input: CourseVersionDraft): Promise<CourseVersion>;
  transitionCourseVersion(
    courseVersionId: string,
    targetState: CourseVersionState,
    expectedVersion: number,
    reason?: string,
  ): Promise<CourseVersion>;
  listRequirements(propertyId: string): Promise<RequirementSummary[]>;
  getRequirementVersion(
    requirementVersionId: string,
  ): Promise<RequirementVersion>;
  saveRequirementVersionDraft(
    input: RequirementVersionDraft,
  ): Promise<RequirementVersion>;
  transitionRequirementVersion(
    requirementVersionId: string,
    targetState: RequirementVersionState,
    expectedVersion: number,
    reason?: string,
  ): Promise<RequirementVersion>;
  evaluateEligibility(input: {
    propertyId: string;
    requirementVersionId: string;
    evaluationDate: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<EligibilityEvaluationPage>;
}
