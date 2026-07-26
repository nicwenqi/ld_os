import type {
  CourseVersion,
  CourseVersionDraft,
  CourseVersionState,
  LearningRequirementRepository,
  RequirementVersion,
  RequirementVersionDraft,
  RequirementVersionState,
} from "../contracts/learning-requirement-repository.ts";

const propertyId = "20000000-0000-0000-0000-000000000011";

export function createMockLearningRequirementRepository():
  LearningRequirementRepository {
  const courses: CourseVersion[] = [];
  const requirements: RequirementVersion[] = [];

  return {
    async readManagerFoundation(candidate) {
      return {
        propertyId: candidate,
        source: "local_review",
        courses: candidate === propertyId ? structuredClone(courses) : [],
        requirements:
          candidate === propertyId ? structuredClone(requirements) : [],
      };
    },
    async readDepartmentRequirements() {
      return {
        propertyId,
        source: "local_review",
        scope: [
          {
            departmentId: "61000000-0000-0000-0000-000000000012",
            departmentName: "前厅部",
            includeDescendants: true,
          },
        ],
        requirements: structuredClone(
          requirements.filter(item => item.state === "effective"),
        ),
      };
    },
    async listCourses(candidate) {
      return courses
        .filter(item => item.propertyId === candidate)
        .map(item => ({
          id: item.courseId,
          propertyId: item.propertyId,
          code: item.code,
          nameZh: item.nameZh,
          nameEn: item.nameEn,
          currentVersionId: item.id,
          currentVersionState: item.state,
          version: item.identityVersion,
        }));
    },
    async getCourseVersion(id) {
      const found = courses.find(item => item.id === id);
      if (!found) throw new Error("未找到课程版本。");
      return structuredClone(found);
    },
    async saveCourseVersionDraft(input) {
      return saveCourseDraft(courses, input);
    },
    async transitionCourseVersion(id, state, expectedVersion, reason) {
      const current = courses.find(item => item.id === id);
      if (!current) throw new Error("未找到课程版本。");
      assertVersion(current.expectedVersion, expectedVersion);
      assertCourseTransition(current.state, state, reason);
      current.state = state;
      current.expectedVersion += 1;
      current.updatedAt = new Date().toISOString();
      return structuredClone(current);
    },
    async listRequirements(candidate) {
      return requirements
        .filter(item => item.propertyId === candidate)
        .map(item => ({
          id: item.requirementId,
          propertyId: item.propertyId,
          code: item.code,
          nameZh: item.nameZh,
          nameEn: item.nameEn,
          currentVersionId: item.id,
          currentVersionState: item.state,
          version: item.identityVersion,
        }));
    },
    async getRequirementVersion(id) {
      const found = requirements.find(item => item.id === id);
      if (!found) throw new Error("未找到培训要求版本。");
      return structuredClone(found);
    },
    async saveRequirementVersionDraft(input) {
      return saveRequirementDraft(requirements, input);
    },
    async transitionRequirementVersion(id, state, expectedVersion, reason) {
      const current = requirements.find(item => item.id === id);
      if (!current) throw new Error("未找到培训要求版本。");
      assertVersion(current.expectedVersion, expectedVersion);
      assertRequirementTransition(current.state, state, reason);
      current.state = state;
      current.expectedVersion += 1;
      current.updatedAt = new Date().toISOString();
      return structuredClone(current);
    },
    async evaluateEligibility(input) {
      return {
        rows: [],
        total: 0,
        evaluatedAt: input.evaluationDate,
        source: "local_review",
      };
    },
  };
}

function saveCourseDraft(
  versions: CourseVersion[],
  input: CourseVersionDraft,
) {
  const now = new Date().toISOString();
  const current = input.courseVersionId
    ? versions.find(item => item.id === input.courseVersionId)
    : undefined;
  if (current) {
    assertVersion(current.expectedVersion, input.expectedVersion);
    if (current.state !== "draft") {
      throw new Error("仅草稿课程版本可以编辑。");
    }
    Object.assign(current, input, {
      expectedVersion: current.expectedVersion + 1,
      updatedAt: now,
    });
    return Promise.resolve(structuredClone(current));
  }
  const created = {
    ...input,
    id: crypto.randomUUID(),
    courseId: input.courseId ?? crypto.randomUUID(),
    identityVersion: 1,
    versionNumber: 1,
    state: "draft",
    expectedVersion: 1,
    createdAt: now,
    updatedAt: now,
  } satisfies CourseVersion;
  if (input.courseId) {
    const lineage = versions.filter(item => item.courseId === input.courseId);
    const currentIdentityVersion = lineage[0]?.identityVersion ?? 1;
    assertVersion(currentIdentityVersion, input.expectedVersion);
    created.identityVersion = currentIdentityVersion + 1;
    created.versionNumber =
      Math.max(0, ...lineage.map(item => item.versionNumber)) + 1;
    lineage.forEach(item => {
      item.identityVersion = created.identityVersion;
    });
  }
  versions.push(created);
  return Promise.resolve(structuredClone(created));
}

function saveRequirementDraft(
  versions: RequirementVersion[],
  input: RequirementVersionDraft,
) {
  const now = new Date().toISOString();
  const current = input.requirementVersionId
    ? versions.find(item => item.id === input.requirementVersionId)
    : undefined;
  if (current) {
    assertVersion(current.expectedVersion, input.expectedVersion);
    if (current.state !== "draft") {
      throw new Error("仅草稿培训要求版本可以编辑。");
    }
    Object.assign(current, input, {
      expectedVersion: current.expectedVersion + 1,
      updatedAt: now,
    });
    return Promise.resolve(structuredClone(current));
  }
  const created = {
    ...input,
    id: crypto.randomUUID(),
    requirementId: input.requirementId ?? crypto.randomUUID(),
    identityVersion: 1,
    versionNumber: 1,
    state: "draft",
    expectedVersion: 1,
    createdAt: now,
    updatedAt: now,
  } satisfies RequirementVersion;
  if (input.requirementId) {
    const lineage = versions.filter(
      item => item.requirementId === input.requirementId,
    );
    const currentIdentityVersion = lineage[0]?.identityVersion ?? 1;
    assertVersion(currentIdentityVersion, input.expectedVersion);
    created.identityVersion = currentIdentityVersion + 1;
    created.versionNumber =
      Math.max(0, ...lineage.map(item => item.versionNumber)) + 1;
    lineage.forEach(item => {
      item.identityVersion = created.identityVersion;
    });
  }
  versions.push(created);
  return Promise.resolve(structuredClone(created));
}

function assertVersion(current: number, expected: number) {
  if (current !== expected) {
    const error = new Error("资料已被其他用户更新，请重新读取后重试。");
    error.name = "ConflictError";
    throw error;
  }
}

function assertCourseTransition(
  current: CourseVersionState,
  next: CourseVersionState,
  reason?: string,
) {
  const allowed = new Set([
    "draft:review",
    "review:draft",
    "review:published",
    "published:retired",
  ]);
  if (!allowed.has(`${current}:${next}`)) throw new Error("不允许的课程状态变化。");
  if ((next === "draft" || next === "retired") && !reason?.trim()) {
    throw new Error("退回或停用版本必须说明原因。");
  }
}

function assertRequirementTransition(
  current: RequirementVersionState,
  next: RequirementVersionState,
  reason?: string,
) {
  const allowed = new Set([
    "draft:approved",
    "approved:effective",
    "approved:retired",
    "effective:retired",
    "superseded:retired",
  ]);
  if (!allowed.has(`${current}:${next}`)) {
    throw new Error("不允许的培训要求状态变化。");
  }
  if (next === "retired" && !reason?.trim()) {
    throw new Error("停用培训要求版本必须说明原因。");
  }
}
