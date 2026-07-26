import assert from "node:assert/strict";
import test from "node:test";
import { dataSourceForModule } from "../app/repositories/registry.ts";
import { createSupabaseLearningRequirementRepository } from "../app/repositories/supabase/learning-requirement-repository.ts";

function fakeClient(responses = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, parameters = {}) {
        calls.push({ name, parameters });
        return responses[name] ?? { data: null, error: null };
      },
    },
  };
}

test("D1 is a validated foundation and Production never selects local-review data", () => {
  assert.equal(dataSourceForModule("learning-requirements", "mock"), "mock");
  assert.equal(
    dataSourceForModule("learning-requirements", "hybrid"),
    "supabase",
  );
  assert.equal(
    dataSourceForModule("learning-requirements", "supabase"),
    "supabase",
  );
});

test("manager foundation is read through the property-authorized RPC", async () => {
  const fixture = {
    propertyId: "property-1",
    source: "real",
    courses: [],
    requirements: [],
  };
  const { client, calls } = fakeClient({
    read_learning_requirement_foundation: { data: fixture, error: null },
  });
  const repository = createSupabaseLearningRequirementRepository(client);
  assert.deepEqual(await repository.readManagerFoundation("property-1"), fixture);
  assert.deepEqual(calls, [
    {
      name: "read_learning_requirement_foundation",
      parameters: { p_property_id: "property-1" },
    },
  ]);
});

test("requirement draft save sends one aggregate with optimistic version", async () => {
  const response = { id: "version-1", expectedVersion: 2 };
  const { client, calls } = fakeClient({
    save_requirement_version_draft: { data: response, error: null },
  });
  const repository = createSupabaseLearningRequirementRepository(client);
  const input = {
    propertyId: "property-1",
    expectedVersion: 1,
    code: "FIRE-ANNUAL",
    nameZh: "年度消防安全要求",
    purpose: "消防安全",
    obligationExplanation: "酒店年度义务",
    effectiveFrom: "2026-01-01",
    changeReason: "首版",
    continuityRationale: "首版",
    timing: { type: "calendar_recurrence", period: "year" },
    completionDefinition: {
      satisfactionOperator: "any_one",
      methods: [],
    },
    ruleSets: [],
  };
  assert.deepEqual(await repository.saveRequirementVersionDraft(input), response);
  assert.deepEqual(calls[0], {
    name: "save_requirement_version_draft",
    parameters: {
      p_property_id: "property-1",
      p_payload: input,
      p_expected_version: 1,
    },
  });
});

test("department read has no browser-selected property or scope parameter", async () => {
  const fixture = {
    propertyId: "property-1",
    source: "real",
    scope: [],
    requirements: [],
  };
  const { client, calls } = fakeClient({
    read_department_learning_requirements: { data: fixture, error: null },
  });
  const repository = createSupabaseLearningRequirementRepository(client);
  assert.deepEqual(await repository.readDepartmentRequirements(), fixture);
  assert.deepEqual(calls, [
    { name: "read_department_learning_requirements", parameters: {} },
  ]);
});

test("repository maps stale writes to the shared conflict contract", async () => {
  const { client } = fakeClient({
    transition_course_version: {
      data: null,
      error: { message: "课程版本已被其他用户更新，请重新读取后重试。" },
    },
  });
  const repository = createSupabaseLearningRequirementRepository(client);
  await assert.rejects(
    repository.transitionCourseVersion(
      "course-version-1",
      "review",
      1,
    ),
    error => error.name === "ConflictError",
  );
});
