import type {
  CourseSummary,
  CourseVersion,
  CourseVersionDraft,
  CourseVersionState,
  DepartmentRequirementFoundation,
  LearningRequirementFoundation,
  LearningRequirementRepository,
  RequirementSummary,
  RequirementVersion,
  RequirementVersionDraft,
  RequirementVersionState,
} from "../contracts/learning-requirement-repository.ts";

type RpcClient = {
  rpc(
    name: string,
    parameters?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export function createSupabaseLearningRequirementRepository(
  client: RpcClient,
): LearningRequirementRepository {
  const readManagerFoundation = async (propertyId: string) =>
    rpc<LearningRequirementFoundation>(
      client,
      "read_learning_requirement_foundation",
      {
      p_property_id: propertyId,
      },
    );

  return {
    readManagerFoundation,
    readDepartmentRequirements: () =>
      rpc<DepartmentRequirementFoundation>(
        client,
        "read_department_learning_requirements",
        {},
      ),
    async listCourses(propertyId) {
      const foundation = await readManagerFoundation(propertyId);
      const latest = latestCourseVersions(foundation.courses);
      return latest.map(course => ({
        id: course.courseId,
        propertyId: course.propertyId,
        code: course.code,
        nameZh: course.nameZh,
        nameEn: course.nameEn,
        currentVersionId: course.id,
        currentVersionState: course.state,
        version: course.identityVersion,
      })) satisfies CourseSummary[];
    },
    async getCourseVersion(courseVersionId) {
      const error = new Error(
        `课程版本 ${courseVersionId} 必须从已授权基础投影中读取。`,
      );
      error.name = "AuthorizedProjectionRequired";
      throw error;
    },
    saveCourseVersionDraft(input: CourseVersionDraft) {
      return rpc(client, "save_course_version_draft", {
        p_property_id: input.propertyId,
        p_payload: input,
        p_expected_version: input.expectedVersion,
      });
    },
    transitionCourseVersion(
      courseVersionId: string,
      targetState: CourseVersionState,
      expectedVersion: number,
      reason?: string,
    ) {
      return rpc(client, "transition_course_version", {
        p_course_version_id: courseVersionId,
        p_target_state: targetState,
        p_expected_version: expectedVersion,
        p_reason: reason ?? null,
      });
    },
    async listRequirements(propertyId) {
      const foundation = await readManagerFoundation(propertyId);
      const latest = latestRequirementVersions(foundation.requirements);
      return latest.map(requirement => ({
        id: requirement.requirementId,
        propertyId: requirement.propertyId,
        code: requirement.code,
        nameZh: requirement.nameZh,
        nameEn: requirement.nameEn,
        currentVersionId: requirement.id,
        currentVersionState: requirement.state,
        version: requirement.identityVersion,
      })) satisfies RequirementSummary[];
    },
    async getRequirementVersion(requirementVersionId) {
      const error = new Error(
        `培训要求版本 ${requirementVersionId} 必须从已授权基础投影中读取。`,
      );
      error.name = "AuthorizedProjectionRequired";
      throw error;
    },
    saveRequirementVersionDraft(input: RequirementVersionDraft) {
      return rpc(client, "save_requirement_version_draft", {
        p_property_id: input.propertyId,
        p_payload: input,
        p_expected_version: input.expectedVersion,
      });
    },
    transitionRequirementVersion(
      requirementVersionId: string,
      targetState: RequirementVersionState,
      expectedVersion: number,
      reason?: string,
    ) {
      return rpc(client, "transition_requirement_version", {
        p_requirement_version_id: requirementVersionId,
        p_target_state: targetState,
        p_expected_version: expectedVersion,
        p_reason: reason ?? null,
      });
    },
    evaluateEligibility(input) {
      return rpc(client, "evaluate_learning_requirement_eligibility", {
        p_property_id: input.propertyId,
        p_requirement_version_id: input.requirementVersionId,
        p_evaluation_date: input.evaluationDate,
        p_search: input.search ?? null,
        p_page: input.page ?? 1,
        p_page_size: input.pageSize ?? 50,
      });
    },
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

function latestCourseVersions(versions: CourseVersion[]) {
  const latest = new Map<string, CourseVersion>();
  for (const version of versions) {
    const current = latest.get(version.courseId);
    if (!current || version.versionNumber > current.versionNumber) {
      latest.set(version.courseId, version);
    }
  }
  return [...latest.values()];
}

function latestRequirementVersions(versions: RequirementVersion[]) {
  const latest = new Map<string, RequirementVersion>();
  for (const version of versions) {
    const current = latest.get(version.requirementId);
    if (!current || version.versionNumber > current.versionNumber) {
      latest.set(version.requirementId, version);
    }
  }
  return [...latest.values()];
}

function businessError(message: string, fallback: string) {
  const normalized = message.includes(":")
    ? message.split(":").slice(1).join(":").trim()
    : message;
  const error = new Error(normalized || fallback);
  if (/已被其他用户更新|重新读取|并发|stale|conflict/i.test(message)) {
    error.name = "ConflictError";
  }
  return error;
}
