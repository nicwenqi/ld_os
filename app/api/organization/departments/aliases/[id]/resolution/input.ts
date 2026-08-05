import type {
  ApproveDepartmentMappingInput,
  CreateDepartmentFromAliasDraft,
} from "../../../../../../repositories/contracts/department-repository.ts";
import {
  parseCreateDepartmentInput,
} from "../../../input.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALIDATION_SCOPE_ID = "00000000-0000-4000-8000-000000000000";

type ResolutionInput = Omit<ApproveDepartmentMappingInput, "aliasId">;

export class AliasResolutionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AliasResolutionInputError";
  }
}

export function parseAliasResolutionInput(value: unknown): ResolutionInput {
  const input = record(value);
  if (input.action === "ignore" || input.action === "defer") {
    exactKeys(input, ["action"]);
    return { action: input.action };
  }
  if (input.action === "operational_unit") {
    exactKeys(input, ["action", "operationalUnitId"]);
    return {
      action: "operational_unit",
      operationalUnitId: uuid(input.operationalUnitId, "运营单元标识无效"),
    };
  }
  if (input.action === "merge") {
    exactKeys(
      input,
      ["action", "targetDepartmentId", "resolutionType"],
      ["action", "targetDepartmentId"],
    );
    if (input.resolutionType !== undefined && input.resolutionType !== "merged") {
      invalid("部门来源标签处理动作无效");
    }
    return {
      action: "merge",
      targetDepartmentId: uuid(input.targetDepartmentId, "正式部门标识无效"),
      ...(input.resolutionType === "merged" ? { resolutionType: "merged" as const } : {}),
    };
  }
  if (input.action === "department") {
    if (input.resolutionType === "created_top_level" || input.resolutionType === "created_child") {
      exactKeys(input, ["action", "resolutionType", "createDepartment"]);
      const createDepartment = departmentDraft(input.createDepartment);
      if (
        (input.resolutionType === "created_top_level" && createDepartment.parentId !== null) ||
        (input.resolutionType === "created_child" && createDepartment.parentId === null)
      ) {
        invalid("新建部门层级与认领动作不一致");
      }
      return { action: "department", resolutionType: input.resolutionType, createDepartment };
    }
    exactKeys(
      input,
      ["action", "targetDepartmentId", "resolutionType"],
      ["action", "targetDepartmentId"],
    );
    if (input.resolutionType !== undefined && input.resolutionType !== "mapped") {
      invalid("部门来源标签处理动作无效");
    }
    return {
      action: "department",
      targetDepartmentId: uuid(input.targetDepartmentId, "正式部门标识无效"),
    };
  }
  invalid("部门来源标签处理动作无效");
}

function departmentDraft(value: unknown): CreateDepartmentFromAliasDraft {
  const draft = record(value, "新建部门资料格式无效");
  exactKeys(draft, ["parentId", "nodeType", "code", "nameZh", "nameEn", "sortOrder"]);
  try {
    const parsed = parseCreateDepartmentInput({
      ...draft,
      tenantId: VALIDATION_SCOPE_ID,
      propertyId: VALIDATION_SCOPE_ID,
    });
    const { tenantId: _tenantId, propertyId: _propertyId, ...result } = parsed;
    return result;
  } catch (error) {
    invalid(error instanceof Error ? error.message : "新建部门资料格式无效");
  }
}

function record(value: unknown, message = "部门来源标签处理请求格式无效") {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(message);
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  keys: string[],
  required = keys,
) {
  if (
    Object.keys(input).some(key => !keys.includes(key)) ||
    required.some(key => !(key in input))
  ) {
    invalid("部门来源标签处理请求包含不支持的字段");
  }
}

function uuid(value: unknown, message: string) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(message);
  return value.toLowerCase();
}

function invalid(message: string): never {
  throw new AliasResolutionInputError(message);
}
