import "server-only";

import { authCookies } from "../api/auth/cookies.ts";
import { withNeonResolvedActorContext } from "../lib/neon/actor-context.ts";
import { resolveNeonPropertyScope } from "../lib/neon/property-context.ts";
import { parseAppEnvironment } from "../lib/environment.ts";
import { createNeonImportStagingRepository } from "../repositories/neon/import-staging-repository.ts";
import type { ImportStagingRepository } from "../repositories/contracts/import-staging-repository.ts";
import { createNeonImportMappingRepository } from "../repositories/neon/import-mapping-repository.ts";
import type { ImportMappingRepository } from "../repositories/contracts/import-mapping-repository.ts";
import { createNeonImportCommitRepository } from "../repositories/neon/import-commit-repository.ts";
import type { ImportCommitRepository } from "../repositories/contracts/import-commit-repository.ts";
import { createVercelBlobImportStorageGateway } from "./import/vercel-blob-import-storage.ts";
import { resolveRequestAuthIdentity } from "./request-authentication.ts";

/** Only the authenticated server actor's Storage surface is exposed. */
export type ImportStorageGateway = Readonly<{
  upload(bucket: "property-import-files", objectPath: string, body: Uint8Array, contentType: string): Promise<void>;
  download(bucket: "property-import-files", objectPath: string): Promise<Uint8Array>;
  remove(bucket: "property-import-files", objectPath: string): Promise<void>;
}>;

export type AuthorizedImportStagingContext = Readonly<{
  authUserId: string;
  hostname: string;
  tenantId: string;
  propertyId: string;
  repository: ImportStagingRepository;
  mappingRepository: ImportMappingRepository;
  commitRepository: ImportCommitRepository;
  storage: ImportStorageGateway;
  headers: Headers;
}>;

export class ImportStagingApiError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 503;
  readonly headers?: Headers;

  constructor(
    status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
    message: string,
    headers?: Headers,
  ) {
    super(message);
    this.name = "ImportStagingApiError";
    this.status = status;
    this.headers = headers;
  }
}

/**
 * Resolves Supabase Auth and the live Neon property scope before invoking a
 * constrained repository. Request bodies cannot select identity or scope.
 * Storage calls are deliberately supplied as an adapter; the repository facade
 * opens a fresh short Actor Context transaction per database operation, so the
 * saga coordinator can perform Storage I/O only between those transactions.
 */
export async function runAuthorizedNeonImportStaging<T>(
  request: Request,
  requestId: string,
  operation: (context: AuthorizedImportStagingContext) => Promise<T>,
): Promise<{ data: T; headers: Headers }> {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    throw new ImportStagingApiError(503, "Import Neon 数据源尚未启用");
  }

  const identity = await resolveRequestAuthIdentity(request);
  if (!identity) throw new ImportStagingApiError(401, "登录状态已失效");

  const headers = new Headers({
    "Cache-Control": "no-store, private",
    "X-Request-Id": requestId,
  });
  if (identity.refreshed) {
    for (const value of authCookies(identity.accessToken, identity.refreshToken, environment.appEnv !== "local")) {
      headers.append("Set-Cookie", value);
    }
  }

  try {
    const scope = await resolveTrustedImportScope(identity.userId, identity.hostname, requestId);
    const storage = createVercelBlobImportStorageGateway();
    const repository = createScopedImportRepository(identity.userId, identity.hostname, requestId, scope);
    const mappingRepository = createScopedImportMappingRepository(identity.userId, identity.hostname, requestId, scope);
    const commitRepository = createScopedImportCommitRepository(identity.userId, identity.hostname, requestId, scope);
    // This callback runs after the short scope-resolution transaction has
    // closed. Each repository method below starts its own Actor Context.
    const data = await operation({
      authUserId: identity.userId,
      hostname: identity.hostname,
      tenantId: scope.tenantId,
      propertyId: scope.propertyId,
      repository,
      mappingRepository,
      commitRepository,
      storage,
      headers,
    });
    return { data, headers };
  } catch (error) {
    const mapped = mapImportStagingError(error);
    throw new ImportStagingApiError(mapped.status, mapped.message, headers);
  }
}

function createScopedImportCommitRepository(
  authUserId: string,
  hostname: string,
  requestId: string,
  expectedScope: { tenantId: string; propertyId: string },
): ImportCommitRepository {
  const run = async <T>(operation: (repository: ImportCommitRepository) => Promise<T>) => withNeonResolvedActorContext(
    { authUserId, requestId },
    async database => {
      const scope = await resolveNeonPropertyScope(hostname, database);
      if (!scope || scope.tenantId !== expectedScope.tenantId || scope.propertyId !== expectedScope.propertyId) {
        throw new ImportStagingApiError(403, "当前账号无权访问此酒店");
      }
      return scope.propertyId;
    },
    database => operation(createNeonImportCommitRepository(database, hostname)),
  );
  return {
    commit: input => run(repository => repository.commit(input)),
    previewRevert: batchId => run(repository => repository.previewRevert(batchId)),
    revert: input => run(repository => repository.revert(input)),
  };
}

function createScopedImportMappingRepository(
  authUserId: string,
  hostname: string,
  requestId: string,
  expectedScope: { tenantId: string; propertyId: string },
): ImportMappingRepository {
  const run = async <T>(operation: (repository: ImportMappingRepository) => Promise<T>) => withNeonResolvedActorContext(
    { authUserId, requestId },
    async database => {
      const scope = await resolveNeonPropertyScope(hostname, database);
      if (!scope || scope.tenantId !== expectedScope.tenantId || scope.propertyId !== expectedScope.propertyId) {
        throw new ImportStagingApiError(403, "当前账号无权访问此酒店");
      }
      return scope.propertyId;
    },
    database => operation(createNeonImportMappingRepository(database, hostname)),
  );
  return {
    getWorkflow: batchId => run(repository => repository.getWorkflow(batchId)),
    saveFieldMappingDecisions: input => run(repository => repository.saveFieldMappingDecisions(input)),
    saveSourceLabelDecisions: input => run(repository => repository.saveSourceLabelDecisions(input)),
    saveIssueResolutions: input => run(repository => repository.saveIssueResolutions(input)),
    preview: (batchId, expectedDecisionVersion) => run(repository => repository.preview(batchId, expectedDecisionVersion)),
  };
}

async function resolveTrustedImportScope(
  authUserId: string,
  hostname: string,
  requestId: string,
) {
  let scope: { tenantId: string; propertyId: string } | null = null;
  await withNeonResolvedActorContext(
    { authUserId, requestId },
    async database => {
      const property = await resolveNeonPropertyScope(hostname, database);
      if (!property) throw new ImportStagingApiError(403, "当前账号无权访问此酒店");
      scope = property;
      return property.propertyId;
    },
    async () => undefined,
  );
  if (!scope) throw new ImportStagingApiError(403, "当前账号无权访问此酒店");
  return scope;
}

function createScopedImportRepository(
  authUserId: string,
  hostname: string,
  requestId: string,
  expectedScope: { tenantId: string; propertyId: string },
): ImportStagingRepository {
  const run = async <T>(operation: (repository: ImportStagingRepository) => Promise<T>) => withNeonResolvedActorContext(
    { authUserId, requestId },
    async database => {
      const scope = await resolveNeonPropertyScope(hostname, database);
      if (!scope || scope.tenantId !== expectedScope.tenantId || scope.propertyId !== expectedScope.propertyId) {
        throw new ImportStagingApiError(403, "当前账号无权访问此酒店");
      }
      return scope.propertyId;
    },
    database => operation(createNeonImportStagingRepository(database, hostname, expectedScope)),
  );
  return {
    createUploadIntent: input => run(repository => repository.createUploadIntent(input)),
    recordObjectUploaded: (batchId, expectedVersion) => run(repository => repository.recordObjectUploaded(batchId, expectedVersion)),
    recordObjectVerification: input => run(repository => repository.recordObjectVerification(input)),
    stageVerifiedWorkbook: input => run(repository => repository.stageVerifiedWorkbook(input)),
    markCleanupPending: input => run(repository => repository.markCleanupPending(input)),
    claimDueCleanup: input => run(repository => repository.claimDueCleanup(input)),
    completeCleanup: input => run(repository => repository.completeCleanup(input)),
    failCleanup: input => run(repository => repository.failCleanup(input)),
    getWorkflow: batchId => run(repository => repository.getWorkflow(batchId)),
    listHistory: () => run(repository => repository.listHistory()),
  };
}

export function importStagingErrorResponse(error: unknown, requestId: string) {
  const mapped = mapImportStagingError(error);
  return Response.json(
    { message: mapped.message },
    { status: mapped.status, headers: mapped.headers ?? new Headers({ "Cache-Control": "no-store, private", "X-Request-Id": requestId }) },
  );
}

function mapImportStagingError(error: unknown): ImportStagingApiError {
  if (error instanceof ImportStagingApiError) return error;
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "42501" || /MANAGER_FORBIDDEN|PROPERTY_FORBIDDEN|PROPERTY_CONTEXT_CHANGED/.test(message)) {
    return new ImportStagingApiError(403, "当前账号没有员工资料导入权限");
  }
  if (code === "P0002" || /NOT_FOUND/.test(message)) return new ImportStagingApiError(404, "导入批次不存在或无权访问");
  if (code === "40001" || code === "40P01" || /STALE|CONFLICT/.test(message)) return new ImportStagingApiError(409, "导入批次已被更新，请刷新后重试");
  if (code === "22023" || code === "23514" || /INVALID/.test(message)) return new ImportStagingApiError(422, "导入暂存证据不符合当前业务规则");
  return new ImportStagingApiError(503, "导入暂存服务暂时不可用");
}
