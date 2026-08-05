import { resolveRequestId } from "../../../lib/neon/request-id.ts";
import type {
  DepartmentEmployeeDirectoryOptions,
  EmployeeDirectoryOptions,
  EmployeeRecord,
} from "../../../repositories/contracts/employee-repository.ts";
import {
  PeopleApiError,
  peopleErrorResponse,
  runAuthorizedNeonPeopleRead,
} from "../../../services/neon-people-authorization.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPLOYMENT_STATUSES = new Set<EmployeeRecord["employmentStatus"]>([
  "active",
  "inactive",
  "leave",
  "terminated",
  "unknown",
]);
const MANAGER_QUERY_KEYS = new Set([
  "query",
  "departmentId",
  "positionId",
  "positionFamilyId",
  "employmentStatus",
  "active",
  "limit",
  "offset",
]);
const DEPARTMENT_BODY_KEYS = new Set(["query", "limit", "offset"]);

export async function GET(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const options = managerOptions(new URL(request.url).searchParams);
    const result = await runAuthorizedNeonPeopleRead(
      request,
      requestId,
      repository => repository.listManagerDirectory(options),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return peopleErrorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    const options = await departmentOptions(request);
    const result = await runAuthorizedNeonPeopleRead(
      request,
      requestId,
      repository => repository.listDepartmentDirectory(options),
    );
    return Response.json(result.data, { headers: result.headers });
  } catch (error) {
    return peopleErrorResponse(error, requestId);
  }
}

function managerOptions(search: URLSearchParams): EmployeeDirectoryOptions {
  for (const key of search.keys()) {
    if (!MANAGER_QUERY_KEYS.has(key)) invalid("包含不支持的员工筛选条件");
  }

  const departmentId = optionalUuid(search.get("departmentId"));
  const positionId = optionalUuid(search.get("positionId"));
  const positionFamilyId = optionalUuid(search.get("positionFamilyId"));
  const employmentStatus = search.get("employmentStatus")?.trim() || undefined;
  if (
    employmentStatus &&
    !EMPLOYMENT_STATUSES.has(employmentStatus as EmployeeRecord["employmentStatus"])
  ) {
    invalid("员工状态筛选无效");
  }

  const activeValue = search.get("active");
  if (activeValue !== null && activeValue !== "true" && activeValue !== "false") {
    invalid("在职筛选无效");
  }

  return {
    ...queryOption(search.get("query")),
    ...(departmentId ? { departmentId } : {}),
    ...(positionId ? { positionId } : {}),
    ...(positionFamilyId ? { positionFamilyId } : {}),
    ...(employmentStatus
      ? { employmentStatus: employmentStatus as EmployeeRecord["employmentStatus"] }
      : {}),
    ...(activeValue !== null ? { active: activeValue === "true" } : {}),
    limit: integer(search.get("limit"), 25, 1, 100, "分页条数"),
    offset: integer(search.get("offset"), 0, 0, 1_000_000, "分页位置"),
  };
}

async function departmentOptions(
  request: Request,
): Promise<DepartmentEmployeeDirectoryOptions> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    invalid("部门员工目录请求格式无效");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid("部门员工目录请求格式无效");
  }
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!DEPARTMENT_BODY_KEYS.has(key)) invalid("部门目录不接受浏览器授权范围");
  }
  if (body.query !== undefined && typeof body.query !== "string") {
    invalid("部门员工搜索内容无效");
  }
  return {
    ...queryOption(typeof body.query === "string" ? body.query : null),
    limit: integerValue(body.limit, 25, 1, 100, "分页条数"),
    offset: integerValue(body.offset, 0, 0, 1_000_000, "分页位置"),
  };
}

function queryOption(value: string | null) {
  const query = value?.trim();
  if (!query) return {};
  if (query.length > 160) invalid("员工搜索内容过长");
  return { query };
}

function optionalUuid(value: string | null) {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (!UUID_PATTERN.test(normalized)) invalid("员工筛选标识无效");
  return normalized.toLowerCase();
}

function integer(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  return integerValue(value, fallback, minimum, maximum, label);
}

function integerValue(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    invalid(`${label}无效`);
  }
  return number;
}

function invalid(message: string): never {
  throw new PeopleApiError(400, message);
}
