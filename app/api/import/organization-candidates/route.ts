import { createServerActorClient } from "../../../lib/supabase/server-admin.ts";
import { AuthorizationError, requireProductionPropertyManager } from "../../../services/production-authorization.ts";

type Dependencies = {
  authorize: typeof requireProductionPropertyManager;
  actorClient: typeof createServerActorClient;
};

const defaults: Dependencies = {
  authorize: requireProductionPropertyManager,
  actorClient: createServerActorClient,
};

export function createOrganizationCandidateHandler(dependencies: Dependencies = defaults) {
  return async function handle(request: Request) {
    try {
      const actor = await dependencies.authorize(request);
      const body = await request.json() as { batchId?: string; expectedVersion?: number; decisions?: unknown[] };
      if (!body.batchId || !Number.isInteger(body.expectedVersion)) return Response.json({ message: "组织候选请求缺少批次版本" }, { status: 400 });
      const client = dependencies.actorClient(actor.accessToken);
      const isConfirm = Array.isArray(body.decisions);
      const { data, error } = await client.rpc(
        isConfirm ? "confirm_employee_import_organization_candidates" : "preview_employee_import_organization_candidates",
        isConfirm
          ? { p_batch_id: body.batchId, p_expected_version: body.expectedVersion, p_decisions: body.decisions }
          : { p_batch_id: body.batchId, p_expected_version: body.expectedVersion },
      );
      if (error) return Response.json({ message: "组织候选操作失败，请重新读取批次" }, { status: 422 });
      const headers = new Headers({ "Cache-Control": "no-store, private" });
      for (const value of actor.refreshedCookies) headers.append("Set-Cookie", value);
      return Response.json(data, { status: 200, headers });
    } catch (error) {
      if (error instanceof AuthorizationError) return Response.json({ message: error.message }, { status: error.status });
      return Response.json({ message: "组织候选操作失败" }, { status: 422 });
    }
  };
}

export const POST = createOrganizationCandidateHandler();
