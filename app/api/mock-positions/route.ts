import { parseAppEnvironment } from "../../lib/environment.ts";
import { createMockPositionRepository } from "../../repositories/mock/position-repository.ts";
import { requireLocalReviewManager } from "../../services/local-review-authorization.ts";
import { AuthorizationError } from "../../services/production-authorization.ts";

const repository = createMockPositionRepository();

export async function POST(request: Request) {
  try {
    assertLocalReview();
    requireLocalReviewManager(request);
    const body = await request.json() as {
      action?: string;
      input?: Record<string, unknown>;
    };
    const input = body.input ?? {};
    const value = await dispatch(body.action ?? "", input);
    return Response.json(value, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json(
        { message: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store, private" } },
      );
    }
    const status = error instanceof Error && error.name === "ConflictError" ? 409 : 422;
    return Response.json(
      { message: error instanceof Error ? error.message : "本地职位验证操作失败" },
      { status, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}

function assertLocalReview() {
  const environment = parseAppEnvironment();
  if (environment.appEnv !== "local" || environment.dataMode !== "mock") {
    throw new Error("本地职位验证来源不可用");
  }
}

async function dispatch(action: string, input: Record<string, unknown>) {
  if (action === "listPositionFamilies") {
    return repository.listPositionFamilies(text(input.propertyId));
  }
  if (action === "savePositionFamily") {
    return repository.savePositionFamily(input as never);
  }
  if (action === "listPositions") {
    return repository.listPositions(text(input.propertyId));
  }
  if (action === "savePosition") return repository.savePosition(input as never);
  if (action === "savePositionWithDepartments") {
    return repository.savePositionWithDepartments(input as never);
  }
  if (action === "assignPositionToDepartments") {
    return repository.assignPositionToDepartments(
      text(input.positionId),
      stringArray(input.departmentIds),
    );
  }
  if (action === "listSourceLabels") {
    return repository.listSourceLabels(text(input.propertyId));
  }
  if (action === "previewSourceImpact") {
    return repository.previewSourceImpact(text(input.sourceLabelId));
  }
  if (action === "approvePositionMapping") {
    return repository.approvePositionMapping(input as never);
  }
  throw new Error("不支持的本地职位验证操作");
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
}
