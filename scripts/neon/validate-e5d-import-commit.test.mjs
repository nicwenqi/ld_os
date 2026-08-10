import test from "node:test";
import assert from "node:assert/strict";
import { validateE5dImportCommitSource, validateE5dImportCommitRepositorySource } from "./validate-e5d-import-commit.mjs";

test("E5D source gate requires canonical commit/revert schema and entrypoints", async () => {
  const result = await validateE5dImportCommitSource();
  assert.equal(result.schema, "e5d-import-commit");
  assert.equal(result.entrypoints.length, 3);
  assert.equal(result.stagedEvidenceImmutable, true);
  assert.equal(result.employeeDeleteForbidden, true);
  assert.equal(result.authoritativeLocks, true);
  assert.equal(result.employeeMutationCore, true);
});

test("E5D repository gate requires a server-only constrained boundary", async () => {
  const result = await validateE5dImportCommitRepositorySource();
  assert.equal(result.serverOnly, true);
  assert.equal(result.rawTableQueries, 0);
});
