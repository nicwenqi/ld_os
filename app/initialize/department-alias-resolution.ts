import type {
  ApproveDepartmentMappingInput,
} from "../repositories/contracts/department-repository.ts";

export type CreatedDepartmentAliasResolutionInput = {
  aliasId: string;
  action: "create-root" | "create-child";
  parentId: string | null;
  code: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
};

export function createdDepartmentAliasResolution(
  input: CreatedDepartmentAliasResolutionInput,
): ApproveDepartmentMappingInput {
  const resolutionType = input.action === "create-root"
    ? "created_top_level"
    : "created_child";
  const parentId = input.action === "create-root" ? null : input.parentId;
  if (resolutionType === "created_child" && !parentId) {
    throw new Error("请选择上级部门");
  }
  return {
    aliasId: input.aliasId,
    action: "department",
    resolutionType,
    createDepartment: {
      parentId,
      nodeType: "department",
      code: input.code,
      nameZh: input.nameZh,
      nameEn: input.nameEn,
      sortOrder: input.sortOrder,
    },
  };
}
