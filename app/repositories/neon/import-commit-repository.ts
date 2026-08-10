import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type { ImportCommitRepository, ImportCommitResult, ImportRevertPreview } from "../contracts/import-commit-repository.ts";

type PayloadRow = { payload: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export function createNeonImportCommitRepository(database: NeonQueryable, trustedHostname: string): ImportCommitRepository {
  const hostname = text(trustedHostname, "trustedHostname", 255);
  return {
    async commit(input) {
      const value = commitInput(input);
      const result = await database.query<PayloadRow>(
        "select public.commit_neon_import_batch($1::text,$2::uuid,$3::bigint,$4::bigint,$5::text,$6::boolean) as payload",
        [hostname, value.batchId, value.expectedBatchVersion, value.expectedDecisionVersion, value.previewHash, true],
      );
      return commitResult(result.rows[0]?.payload, "commit.payload");
    },
    async previewRevert(batchId) {
      const id = uuid(batchId, "previewRevert.batchId");
      const result = await database.query<PayloadRow>(
        "select public.preview_neon_import_revert($1::text,$2::uuid) as payload",
        [hostname, id],
      );
      return revertPreview(result.rows[0]?.payload, "previewRevert.payload");
    },
    async revert(input) {
      const value = revertInput(input);
      const result = await database.query<PayloadRow>(
        "select public.revert_neon_import_batch($1::text,$2::uuid,$3::bigint,$4::boolean) as payload",
        [hostname, value.batchId, value.expectedCommitVersion, true],
      );
      return commitResult(result.rows[0]?.payload, "revert.payload");
    },
  };
}

function commitInput(input: Parameters<ImportCommitRepository["commit"]>[0]) {
  if (!input || input.confirmed !== true) throw new Error("NEON_IMPORT_COMMIT_CONFIRMATION_REQUIRED");
  return {
    batchId: uuid(input.batchId, "commit.batchId"),
    expectedBatchVersion: positive(input.expectedBatchVersion, "commit.expectedBatchVersion"),
    expectedDecisionVersion: positive(input.expectedDecisionVersion, "commit.expectedDecisionVersion"),
    previewHash: hash(input.previewHash, "commit.previewHash"),
  };
}

function revertInput(input: Parameters<ImportCommitRepository["revert"]>[0]) {
  if (!input || input.confirmed !== true) throw new Error("NEON_IMPORT_REVERT_CONFIRMATION_REQUIRED");
  return { batchId: uuid(input.batchId, "revert.batchId"), expectedCommitVersion: positive(input.expectedCommitVersion, "revert.expectedCommitVersion") };
}

function commitResult(value: unknown, field: string): ImportCommitResult {
  const row = record(value, field);
  const result: ImportCommitResult = {
    commitId: uuid(row.commitId, `${field}.commitId`),
    batchId: uuid(row.batchId, `${field}.batchId`),
    status: enumValue(row.status, new Set(["committed", "reverted"]), `${field}.status`),
    version: positive(row.version, `${field}.version`),
  };
  for (const key of ["previewHash", "batchVersion", "decisionVersion", "inserted", "updated", "unchanged", "excluded"] as const) {
    if (row[key] !== undefined && row[key] !== null) (result as Record<string, unknown>)[key] = key === "previewHash" ? hash(row[key], `${field}.${key}`) : nonnegative(row[key], `${field}.${key}`);
  }
  if (row.destructiveDelete !== undefined && row.destructiveDelete !== false) throw new Error(`${field}.destructiveDelete`);
  if (row.destructiveDelete === false) result.destructiveDelete = false;
  return result;
}

function revertPreview(value: unknown, field: string): ImportRevertPreview {
  const row = record(value, field);
  const dependency = record(row.dependencyChecks, `${field}.dependencyChecks`);
  if (row.strategy !== "compensating_employee_mutation_no_delete" || dependency.destructiveDelete !== "never") throw new Error(`${field}.strategy`);
  return {
    safe: booleanValue(row.safe, `${field}.safe`),
    conflicts: nonnegative(row.conflicts, `${field}.conflicts`),
    strategy: "compensating_employee_mutation_no_delete",
    commitVersion: positive(row.commitVersion, `${field}.commitVersion`),
    dependencyChecks: {
      currentEmployeeVersions: enumValue(dependency.currentEmployeeVersions, new Set(["pass", "conflict"]), `${field}.dependencyChecks.currentEmployeeVersions`),
      destructiveDelete: "never",
    },
  };
}

function record(value: unknown, field: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return value as Record<string, any>; }
function text(value: unknown, field: string, max: number): string { if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return value; }
function uuid(value: unknown, field: string): string { const result = text(value, field, 100); if (!UUID.test(result)) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return result; }
function hash(value: unknown, field: string): string { const result = text(value, field, 100); if (!HASH.test(result)) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return result; }
function positive(value: unknown, field: string): number { const result = nonnegative(value, field); if (result < 1) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return result; }
function nonnegative(value: unknown, field: string): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return Number(value); }
function booleanValue(value: unknown, field: string): boolean { if (typeof value !== "boolean") throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return value; }
function enumValue<T extends string>(value: unknown, allowed: Set<T>, field: string): T { if (typeof value !== "string" || !allowed.has(value as T)) throw new Error(`NEON_IMPORT_COMMIT_PAYLOAD_INVALID:${field}`); return value as T; }
