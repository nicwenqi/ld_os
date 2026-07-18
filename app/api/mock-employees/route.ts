import { readCookie } from "../auth/cookies.ts";
import { readMockSession } from "../auth/mock-session-store.ts";
import { parseAppEnvironment } from "../../lib/environment.ts";
import type { DepartmentEmployeeDirectoryOptions } from "../../repositories/contracts/employee-repository.ts";
import { createMockEmployeeRepository } from "../../repositories/mock/employee-repository.ts";
import { AuthorizationError } from "../../services/production-authorization.ts";

export async function POST(request: Request) {
  try {
    assertLocalReview();
    const session = readMockSession(readCookie(request));
    if (!session?.authenticated) {
      throw new AuthorizationError(401, "请先登录当前酒店");
    }
    if (
      session.role !== "department_training_responsible"
      || session.propertyId !== "synthetic-property-a1"
    ) {
      throw new AuthorizationError(403, "仅部门培训负责人可读取授权范围内员工");
    }

    const body = await request.json() as {
      action?: string;
      input?: Record<string, unknown>;
    };
    if (body.action !== "listDepartmentEmployees") {
      throw new Error("不支持的本地员工目录操作");
    }
    const input = directoryOptions(body.input ?? {});
    const repository = createMockEmployeeRepository({
      departmentScopes: session.departmentScopes,
    });
    const result = await repository.listDepartmentEmployees(input);
    return Response.json(result, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return Response.json(
        { message: error.message },
        {
          status: error.status,
          headers: { "Cache-Control": "no-store, private" },
        },
      );
    }
    return Response.json(
      { message: error instanceof Error ? error.message : "本地员工目录读取失败" },
      {
        status: 422,
        headers: { "Cache-Control": "no-store, private" },
      },
    );
  }
}

function assertLocalReview() {
  const environment = parseAppEnvironment();
  if (environment.appEnv !== "local" || environment.dataMode !== "mock") {
    throw new Error("本地员工目录来源不可用");
  }
}

function directoryOptions(input: Record<string, unknown>): DepartmentEmployeeDirectoryOptions {
  const query = typeof input.query === "string" ? input.query : undefined;
  const limit = finiteInteger(input.limit);
  const offset = finiteInteger(input.offset);
  return {
    ...(query ? { query } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

function finiteInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) ? number : undefined;
}
