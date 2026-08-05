import "server-only";

import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type {
  DepartmentRepository,
  UpdateDepartmentInput,
} from "../contracts/department-repository.ts";
import type { DepartmentNode } from "../contracts/organization-models.ts";
import {
  createNeonDepartmentReadRepository,
  mapNeonDepartmentNode,
} from "./department-read-repository.ts";

type PayloadRow = { payload: unknown };

export type NeonDepartmentWriteRepository = Pick<
  DepartmentRepository,
  "createNode" | "updateNode" | "setActive"
>;

export function createNeonDepartmentWriteRepository(
  database: NeonQueryable,
  trustedHostname: string,
): NeonDepartmentWriteRepository {
  return {
    async createNode(input) {
      const result = await database.query<PayloadRow>(
        `
          select public.create_neon_organization_department(
            $1::text,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            $5::text,
            $6::text,
            $7::text,
            $8::text,
            $9::integer
          ) as payload
        `,
        [
          trustedHostname,
          input.tenantId,
          input.propertyId,
          input.parentId,
          input.nodeType,
          input.code,
          input.nameZh,
          input.nameEn,
          input.sortOrder,
        ],
      );
      const node = mutationNode(result.rows[0]?.payload);
      if (
        node.tenantId !== input.tenantId ||
        node.propertyId !== input.propertyId ||
        node.parentId !== input.parentId
      ) {
        invalid("create scope mismatch");
      }
      return node;
    },

    async updateNode(input) {
      return updateNode(database, trustedHostname, input);
    },

    async setActive(id, expectedVersion, active) {
      const current = await createNeonDepartmentReadRepository(
        database,
        trustedHostname,
      ).getNode(id);
      if (!current) {
        const error = new Error("NEON_ORGANIZATION_DEPARTMENT_NOT_FOUND");
        error.name = "NotFoundError";
        throw error;
      }
      return updateNode(database, trustedHostname, {
        id,
        expectedVersion,
        nameZh: current.nameZh,
        nameEn: current.nameEn ?? "",
        sortOrder: current.sortOrder,
        isActive: active,
      });
    },
  };
}

async function updateNode(
  database: NeonQueryable,
  trustedHostname: string,
  input: UpdateDepartmentInput,
): Promise<DepartmentNode> {
  const result = await database.query<PayloadRow>(
    `
      select public.update_neon_organization_department(
        $1::text,
        $2::uuid,
        $3::bigint,
        $4::text,
        $5::text,
        $6::integer,
        $7::boolean
      ) as payload
    `,
    [
      trustedHostname,
      input.id,
      input.expectedVersion,
      input.nameZh,
      input.nameEn,
      input.sortOrder,
      input.isActive,
    ],
  );
  const node = mutationNode(result.rows[0]?.payload);
  if (node.id !== input.id) invalid("update id mismatch");
  return node;
}

function mutationNode(payload: unknown) {
  if (payload === undefined) invalid("missing mutation payload");
  return mapNeonDepartmentNode(payload);
}

function invalid(detail: string): never {
  throw new Error(`NEON_ORGANIZATION_PAYLOAD_INVALID:${detail}`);
}
