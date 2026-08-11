import type { AppDataMode } from "../lib/environment.ts";
import {
  assertProductionDataBoundary,
  parseAppEnvironment,
  type AppEnvironment,
} from "../lib/environment.ts";
import type { RepositoryDataSource } from "./contracts/models.ts";
import type { PropertyRepository } from "./contracts/property-repository.ts";
import type { DepartmentRepository } from "./contracts/department-repository.ts";
import type { PositionRepository } from "./contracts/position-repository.ts";
import type { EmployeeRepository } from "./contracts/employee-repository.ts";
import type { ImportRepository } from "./contracts/import-repository.ts";
import type { InitializationRepository } from "./contracts/initialization-repository.ts";
import { createMockDepartmentRepository } from "./mock/department-repository.ts";
import { createHttpDepartmentRepository } from "./http/department-repository.ts";
import { createHttpImportRepository } from "./http/import-repository.ts";
import { createHttpEmployeeRepository } from "./http/employee-repository.ts";
import { createHttpPositionRepository } from "./http/position-repository.ts";
import { createHttpPropertyRepository } from "./http/property-repository.ts";
import { createHttpInitializationRepository } from "./http/initialization-repository.ts";
import { createMockPositionRepository } from "./mock/position-repository.ts";
import { createMockPropertyRepository } from "./mock/property-repository.ts";
import { createMockEmployeeRepository } from "./mock/employee-repository.ts";
import { createMockImportRepository } from "./mock/import-repository.ts";
import { createMockInitializationRepository } from "./mock/initialization-repository.ts";

export type ModuleName =
  | "hotel-settings"
  | "organization-management"
  | "position-management"
  | "executive-dashboard"
  | "organization-dashboard"
  | "calendar"
  | "sessions"
  | "qr-check-in"
  | "qr-feedback"
  | "risk"
  | "course-effectiveness"
  | "kpi"
  | "people"
  | "import";

export function dataSourceForModule(
  moduleName: ModuleName,
  dataMode: AppDataMode,
  _organizationMode?: never,
): RepositoryDataSource {
  const foundationModules: ModuleName[] = [
    "hotel-settings",
    "organization-management",
    "position-management",
    "people",
    "import",
  ];
  if (!foundationModules.includes(moduleName)) return "unavailable";
  if (dataMode === "neon") return "neon";
  return dataMode === "mock" ? "mock" : "neon";
}

export function createRepositoryRegistry(input?: {
  environment?: AppEnvironment;
  propertyRepository?: PropertyRepository;
  departmentRepository?: DepartmentRepository;
  positionRepository?: PositionRepository;
  employeeRepository?: EmployeeRepository;
  importRepository?: ImportRepository;
  initializationRepository?: InitializationRepository;
}) {
  const environment = input?.environment ?? parseAppEnvironment();
  assertProductionDataBoundary(environment.appEnv, environment.dataMode);
  const propertySource = dataSourceForModule("hotel-settings", environment.dataMode);
  const property = input?.propertyRepository ?? (
    environment.dataMode === "neon"
        ? createHttpPropertyRepository()
        : createMockPropertyRepository()
  );
  const departmentSource = dataSourceForModule(
    "organization-management",
    environment.dataMode,
  );
  const department = input?.departmentRepository ?? (
    departmentSource === "neon"
      ? createHttpDepartmentRepository()
      : createMockDepartmentRepository()
  );
  const position = input?.positionRepository ?? (
    dataSourceForModule("position-management", environment.dataMode) === "neon"
        ? createHttpPositionRepository()
        : createMockPositionRepository()
  );
  const employee = input?.employeeRepository ?? (
    dataSourceForModule("people", environment.dataMode) === "neon"
        ? createHttpEmployeeRepository()
        : createMockEmployeeRepository()
  );
  const importCenter = input?.importRepository ?? (
    dataSourceForModule("import", environment.dataMode) === "neon"
        ? createHttpImportRepository()
        : createMockImportRepository()
  );
  const initialization = input?.initializationRepository ?? (
    environment.dataMode === "neon"
        ? createHttpInitializationRepository()
        : createMockInitializationRepository()
  );
  return { environment, property, department, position, employee, import: importCenter, initialization, dataSourceForModule: (moduleName: ModuleName) => dataSourceForModule(moduleName, environment.dataMode) };
}
