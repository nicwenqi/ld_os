import assert from "node:assert/strict";
import test from "node:test";

test("C5-B accepts the complete manager initialization projection", async () => {
  const { parseInitializationAccessSummary } = await import(
    "../app/services/initialization-access-projection.ts"
  );
  const projection = {
    currentManager: {
      displayName: "测试酒店学习与发展经理",
      loginId: "pilot-manager",
      accountStatus: "active",
    },
    activePropertyManagers: 1,
    activeDepartmentAdministrators: 1,
    activeDepartmentAdministratorsWithScope: 1,
    departmentScopesResolved: true,
    canConfirm: true,
  };

  assert.deepEqual(parseInitializationAccessSummary(projection), projection);
});

test("C5-B rejects an incomplete or misleading initialization projection", async () => {
  const { parseInitializationAccessSummary } = await import(
    "../app/services/initialization-access-projection.ts"
  );
  assert.equal(parseInitializationAccessSummary(null), null);
  assert.equal(parseInitializationAccessSummary({ canConfirm: true }), null);
  assert.equal(parseInitializationAccessSummary({
    currentManager: null,
    activePropertyManagers: 1,
    activeDepartmentAdministrators: 1,
    activeDepartmentAdministratorsWithScope: 2,
    departmentScopesResolved: true,
    canConfirm: true,
  }), null, "scoped administrator count cannot exceed the active administrator count");
});
