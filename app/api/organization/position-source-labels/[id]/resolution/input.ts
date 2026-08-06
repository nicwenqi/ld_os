import type { ApprovePositionMappingInput } from "../../../../../repositories/contracts/position-repository.ts";

export class PositionMappingInputError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parsePositionMappingInput(value: unknown): Omit<ApprovePositionMappingInput, "sourceLabelId"> {
  const input = object(value);
  const action = input.action;
  if (action === "position") { exactKeys(input, ["action", "targetPositionId"]); return { action, targetPositionId: target(input.targetPositionId) }; }
  if (action === "family") { exactKeys(input, ["action", "targetPositionFamilyId"]); return { action, targetPositionFamilyId: target(input.targetPositionFamilyId) }; }
  if (action === "external") { exactKeys(input, ["action", "externalRoleCode", "externalRoleName"]); return { action, externalRoleCode: text(input.externalRoleCode), externalRoleName: text(input.externalRoleName) }; }
  if (action === "ignore" || action === "defer") {
    exactKeys(input, ["action"]);
    return { action };
  }
  invalid();
}

function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function exactKeys(input: Record<string, unknown>, keys: string[]) { if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input))) invalid(); }
function target(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) invalid(); return value.toLowerCase(); }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) invalid(); return value.trim(); }
function invalid(): never { throw new PositionMappingInputError("职位来源映射请求不符合业务规则"); }
