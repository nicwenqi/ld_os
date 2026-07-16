import { parseAppEnvironment } from "../../lib/environment.ts";
import { createMockDepartmentRepository } from "../../repositories/mock/department-repository.ts";
import { requireLocalReviewManager } from "../../services/local-review-authorization.ts";
import { AuthorizationError } from "../../services/production-authorization.ts";

const repository = createMockDepartmentRepository();

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
      { message: error instanceof Error ? error.message : "本地组织验证操作失败" },
      { status, headers: { "Cache-Control": "no-store, private" } },
    );
  }
}

function assertLocalReview() {
  const environment = parseAppEnvironment();
  if (environment.appEnv !== "local" || environment.dataMode !== "mock") {
    const error = new Error("本地组织验证来源不可用");
    error.name = "NotFoundError";
    throw error;
  }
}

async function dispatch(action: string, input: Record<string, unknown>) {
  if (action === "listTree") return repository.listTree(text(input.propertyId));
  if (action === "getNode") return repository.getNode(text(input.id));
  if (action === "getAncestors") return repository.getAncestors(text(input.id));
  if (action === "getDescendants") return repository.getDescendants(text(input.id));
  if (action === "createNode") return repository.createNode(input as never);
  if (action === "updateNode") return repository.updateNode(input as never);
  if (action === "previewMove") {
    return repository.previewMove(text(input.id), nullableText(input.newParentId));
  }
  if (action === "moveNode") {
    return repository.moveNode(
      text(input.id),
      nullableText(input.newParentId),
      integer(input.expectedVersion),
    );
  }
  if (action === "setActive") {
    return repository.setActive(
      text(input.id),
      integer(input.expectedVersion),
      input.active === true,
    );
  }
  if (action === "listAliases") return repository.listAliases(text(input.propertyId));
  if (action === "approveMapping") return repository.approveMapping(input as never);
  if (action === "createOperationalUnit") {
    return repository.createOperationalUnit(input as never);
  }
  if (action === "saveOperationalUnit") {
    return repository.saveOperationalUnit(input as never);
  }
  if (action === "listOperationalUnits") {
    return repository.listOperationalUnits(text(input.propertyId));
  }
  throw new Error("不支持的本地组织验证操作");
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function integer(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error("版本资料无效");
  return number;
}
