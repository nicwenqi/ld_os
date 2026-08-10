import type { AppEnvironment } from "../../lib/environment.ts";
import type { DepartmentRepository } from "../contracts/department-repository.ts";
import type { EmployeeRepository } from "../contracts/employee-repository.ts";
import type { PeopleFacetRepository } from "../contracts/people-facet-repository.ts";
import type { PositionRepository } from "../contracts/position-repository.ts";
import type { PropertyRepository } from "../contracts/property-repository.ts";
import type { InitializationRepository } from "../contracts/initialization-repository.ts";
import type { ImportRepository } from "../contracts/import-repository.ts";
import { createHttpDepartmentRepository } from "../http/department-repository.ts";
import { createHttpEmployeeRepository } from "../http/employee-repository.ts";
import { createHttpPeopleFacetRepository } from "../http/people-facet-repository.ts";
import { createHttpPositionRepository } from "../http/position-repository.ts";
import { createHttpPropertyRepository } from "../http/property-repository.ts";
import { createHttpInitializationRepository } from "../http/initialization-repository.ts";
import { createHttpImportRepository } from "../http/import-repository.ts";

export type RuntimeDomainRegistry = {
  source: "neon" | "supabase";
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">;
  department: DepartmentRepository;
  employee: EmployeeRepository;
  peopleFacets: PeopleFacetRepository | null;
  position: PositionRepository;
  property: PropertyRepository;
  initialization: InitializationRepository;
  import: ImportRepository;
};

export function createNeonDomainRegistry(
  environment: Pick<AppEnvironment, "appEnv" | "dataMode">,
): RuntimeDomainRegistry {
  return {
    source: "neon",
    environment,
    department: createHttpDepartmentRepository(),
    employee: createHttpEmployeeRepository(),
    peopleFacets: createHttpPeopleFacetRepository(),
    position: createHttpPositionRepository(),
    property: createHttpPropertyRepository(),
    initialization: createHttpInitializationRepository(),
    import: createHttpImportRepository(),
  };
}
