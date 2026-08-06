import type {
  ApprovePositionMappingInput,
  PositionRepository,
  SavePositionFamilyInput,
  SavePositionInput,
  SavePositionWithDepartmentsInput,
} from "../contracts/position-repository.ts";
import type {
  OfficialPosition,
  PositionFamily,
  PositionSourceImpact,
  PositionSourceLabel,
} from "../contracts/organization-models.ts";

/**
 * Browser boundary for the full Position contract. Every request is same-origin;
 * server routes derive actor, property, tenant, and role from trusted context.
 */
export function createHttpPositionRepository(): PositionRepository {
  return {
    listPositionFamilies(_propertyId) {
      return request<PositionFamily[]>("/api/organization/position-families");
    },
    savePositionFamily(input) {
      const id = input.id;
      return id
        ? request<PositionFamily>(
            `${familyUrl(id)}`,
            json("PATCH", familyBody(input, true)),
          )
        : request<PositionFamily>(
            "/api/organization/position-families",
            json("POST", familyBody(input, false)),
          );
    },
    listPositions(_propertyId) {
      return request<OfficialPosition[]>("/api/organization/positions");
    },
    async savePosition(input) {
      const departmentIds = input.id
        ? await existingPosition(input.id).then(position => position.departmentIds)
        : [];
      return saveAtomic({ ...input, departmentIds });
    },
    savePositionWithDepartments(input) {
      return saveAtomic(input);
    },
    async assignPositionToDepartments(positionId, departmentIds) {
      const current = await existingPosition(positionId);
      return saveAtomic({ ...current, departmentIds });
    },
    listSourceLabels(_propertyId) {
      return request<PositionSourceLabel[]>(
        "/api/organization/position-source-labels",
      );
    },
    previewSourceImpact(sourceLabelId) {
      return request<PositionSourceImpact>(
        `${sourceLabelUrl(sourceLabelId)}/impact`,
      );
    },
    approvePositionMapping(input) {
      const { sourceLabelId, ...body } = input;
      return request<PositionSourceLabel>(
        `${sourceLabelUrl(sourceLabelId)}/resolution`,
        json("POST", body),
      );
    },
  };
}

async function existingPosition(id: string): Promise<OfficialPosition> {
  const positions = await request<OfficialPosition[]>("/api/organization/positions");
  const position = positions.find(candidate => candidate.id === id);
  if (!position) throw new Error("正式职位不存在或当前无权访问");
  return position;
}

function saveAtomic(input: SavePositionWithDepartmentsInput): Promise<OfficialPosition> {
  const id = input.id;
  return id
    ? request<OfficialPosition>(
        positionUrl(id),
        json("PATCH", positionBody(input, true)),
      )
    : request<OfficialPosition>(
        "/api/organization/positions",
        json("POST", positionBody(input, false)),
      );
}

function familyBody(input: SavePositionFamilyInput, updating: boolean) {
  const { id: _id, version, tenantId: _tenantId, propertyId: _propertyId, ...body } = input;
  return updating ? { expectedVersion: version, ...body } : body;
}

function positionBody(input: SavePositionWithDepartmentsInput, updating: boolean) {
  const { id: _id, version, tenantId: _tenantId, propertyId: _propertyId, ...body } = input;
  return updating ? { expectedVersion: version, ...body } : body;
}

function familyUrl(id: string) {
  return `/api/organization/position-families/${encodeURIComponent(id)}`;
}

function positionUrl(id: string) {
  return `/api/organization/positions/${encodeURIComponent(id)}`;
}

function sourceLabelUrl(id: string) {
  return `/api/organization/position-source-labels/${encodeURIComponent(id)}`;
}

function json(method: "POST" | "PATCH", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) {
    throw new Error(payload.message ?? "职位服务暂时不可用");
  }
  return payload;
}
