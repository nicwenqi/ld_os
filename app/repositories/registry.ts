import type { AppDataMode } from "../lib/environment.ts";
import { parseAppEnvironment, type AppEnvironment } from "../lib/environment.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/browser.ts";
import type { RepositoryDataSource } from "./contracts/models.ts";
import type { PropertyRepository } from "./contracts/property-repository.ts";
import type { DepartmentRepository } from "./contracts/department-repository.ts";
import type { PositionRepository } from "./contracts/position-repository.ts";
import { createMockDepartmentRepository } from "./mock/department-repository.ts";
import { createMockPositionRepository } from "./mock/position-repository.ts";
import { createMockPropertyRepository } from "./mock/property-repository.ts";
import { createSupabaseDepartmentRepository } from "./supabase/department-repository.ts";
import { createSupabasePositionRepository } from "./supabase/position-repository.ts";
import { createSupabasePropertyRepository } from "./supabase/property-repository.ts";

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
  if (dataMode === "mock") return "mock";
  if (dataMode === "hybrid") return moduleName === "hotel-settings" || moduleName === "organization-management" || moduleName === "position-management" ? "supabase" : "mock";
  return "supabase";
}

export function createRepositoryRegistry(input?: {
  environment?: AppEnvironment;
  propertyRepository?: PropertyRepository;
  departmentRepository?: DepartmentRepository;
  positionRepository?: PositionRepository;
}) {
  const environment = input?.environment ?? parseAppEnvironment();
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
  return { environment, property, department, position, dataSourceForModule: (moduleName: ModuleName) => dataSourceForModule(moduleName, environment.dataMode) };
}
