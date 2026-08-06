export type OrganizationHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 503;

export type OrganizationMappedError = {
  status: OrganizationHttpStatus;
  message: string;
};

export function mapOrganizationDatabaseError(
  error: unknown,
): OrganizationMappedError {
  const code = databaseErrorCode(error);
  const message = error instanceof Error
    ? error.message
    : objectMessage(error);

  if (
    code === "42501" &&
    /^NEON_(?:ORGANIZATION|POSITION)_(?:PROPERTY_CONTEXT_CHANGED|READER_FORBIDDEN|RUNTIME_FORBIDDEN|MANAGER_FORBIDDEN|PROPERTY_FORBIDDEN)$/.test(
      message,
    )
  ) {
    return { status: 403, message: "当前账号没有所请求的组织架构权限" };
  }
  if (
    code === "P2000" ||
    message === "NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND" ||
    message === "NEON_ORGANIZATION_ALIAS_NOT_FOUND" ||
    message === "NEON_ORGANIZATION_OPERATIONAL_UNIT_NOT_FOUND" ||
    message === "NEON_POSITION_ALIAS_NOT_FOUND"
  ) {
    return { status: 404, message: "所请求的组织架构记录不存在" };
  }
  if (
    code === "P2002" ||
    code === "23505" ||
    code === "40001" ||
    code === "40P01"
  ) {
    return { status: 409, message: "部门资料已更新，请刷新后重试" };
  }
  if (code === "P5401") {
    return { status: 422, message: "请先停用或调整下级有效部门" };
  }
  if (code === "P5402") {
    return { status: 422, message: "请先调整该部门的有效培训负责人范围" };
  }
  if (code === "P5403") {
    return { status: 422, message: "请先移除该部门的有效职位分配" };
  }
  if (code === "P5404") {
    return { status: 422, message: "请先停用或调整该部门的有效运营单元" };
  }
  if (
    code === "P5405" ||
    code === "P5406" ||
    code === "P5407" ||
    code === "P5408"
  ) {
    return { status: 422, message: "部门层级移动不符合业务规则" };
  }
  if (
    code === "P2006" ||
    code === "23514" ||
    code === "23502"
  ) {
    return { status: 422, message: "组织架构资料不符合业务规则" };
  }
  return { status: 503, message: "组织架构服务暂时不可用" };
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function objectMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) return "";
  return typeof error.message === "string" ? error.message : "";
}
