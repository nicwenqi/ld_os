import { parseAppEnvironment } from "../../../lib/environment.ts";
import { resolveRequestId } from "../../../lib/neon/request-id.ts";

/** Neon plus the private Vercel Blob gateway is the only live Import path. */
export async function POST(request: Request) {
  const environment = parseAppEnvironment();
  if (environment.dataMode !== "neon") {
    return failure(503, "Import Neon 数据源尚未启用");
  }
  const requestId = resolveRequestId(request);
  const { importStagingErrorResponse } = await import("../../../services/neon-import-staging-authorization.ts");
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return failure(400, "请选择工作簿");
    const { inspectAndStageWorkbookInNeon } = await import("../../../services/import/neon-import-inspection-boundary.ts");
    const result = await inspectAndStageWorkbookInNeon({ request, requestId, file });
    return Response.json(result.data, { status: 201, headers: result.headers });
  } catch (error) {
    return importStagingErrorResponse(error, requestId);
  }
}

function failure(status: number, message: string) {
  return Response.json({ message }, { status, headers: { "Cache-Control": "no-store, private" } });
}
