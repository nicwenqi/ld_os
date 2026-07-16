import type { AppDataMode } from "../lib/environment.ts";
import {
  assertProductionDataBoundary,
  parseAppEnvironment,
  type AppEnvironment,
} from "../lib/environment.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/browser.ts";
import type { RepositoryDataSource } from "./contracts/models.ts";
import type { PropertyRepository } from "./contracts/property-repository.ts";
import type { DepartmentRepository } from "./contracts/department-repository.ts";
import type { PositionRepository } from "./contracts/position-repository.ts";
import type { EmployeeRepository } from "./contracts/employee-repository.ts";
import type { ImportRepository } from "./contracts/import-repository.ts";
import type { InitializationRepository } from "./contracts/initialization-repository.ts";
import { createMockDepartmentRepository } from "./mock/department-repository.ts";
import { createMockPositionRepository } from "./mock/position-repository.ts";
import { createMockPropertyRepository } from "./mock/property-repository.ts";
import { createMockEmployeeRepository } from "./mock/employee-repository.ts";
import { createMockImportRepository } from "./mock/import-repository.ts";
import { createSupabaseDepartmentRepository } from "./supabase/department-repository.ts";
import { createSupabasePositionRepository } from "./supabase/position-repository.ts";
import { createSupabasePropertyRepository } from "./supabase/property-repository.ts";
import { createSupabaseEmployeeRepository } from "./supabase/employee-repository.ts";
import { createSupabaseImportRepository } from "./supabase/import-repository.ts";
import { createMockInitializationRepository } from "./mock/initialization-repository.ts";
import { createSupabaseInitializationRepository } from "./supabase/initialization-repository.ts";

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

export function dataSourceForModule(moduleName: ModuleName, dataMode: AppDataMode): RepositoryDataSource {
  const foundationModules: ModuleName[] = [
    "hotel-settings",
    "organization-management",
    "position-management",
    "people",
    "import",
  ];
  if (!foundationModules.includes(moduleName)) return "unavailable";
  return dataMode === "mock" ? "mock" : "supabase";
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
  const needsSupabase = environment.dataMode !== "mock";
  const client = needsSupabase ? createBrowserSupabaseClient(environment) : null;
  const propertySource = dataSourceForModule("hotel-settings", environment.dataMode);
  const property = input?.propertyRepository ?? (
    propertySource === "supabase"
      ? createSupabasePropertyRepository(client!, environment.supabaseUrl!)
      : createMockPropertyRepository()
  );
  const department = input?.departmentRepository ?? (dataSourceForModule("organization-management", environment.dataMode) === "supabase" ? createSupabaseDepartmentRepository(client!) : createMockDepartmentRepository());
  const position = input?.positionRepository ?? (dataSourceForModule("position-management", environment.dataMode) === "supabase" ? createSupabasePositionRepository(client!) : createMockPositionRepository());
  const employee = input?.employeeRepository ?? (dataSourceForModule("people", environment.dataMode) === "supabase" ? createSupabaseEmployeeRepository(client!) : createMockEmployeeRepository());
  const importCenter = input?.importRepository ?? (dataSourceForModule("import", environment.dataMode) === "supabase" ? createSupabaseImportRepository(client!) : createMockImportRepository());
  const initialization = input?.initializationRepository ?? (propertySource === "supabase" ? createSupabaseInitializationRepository(client!) : createMockInitializationRepository());
  return { environment, property, department, position, employee, import: importCenter, initialization, dataSourceForModule: (moduleName: ModuleName) => dataSourceForModule(moduleName, environment.dataMode) };
}
