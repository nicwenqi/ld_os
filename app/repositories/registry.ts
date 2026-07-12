import type { AppDataMode } from "../lib/environment.ts";
import { parseAppEnvironment, type AppEnvironment } from "../lib/environment.ts";
import { createBrowserSupabaseClient } from "../lib/supabase/browser.ts";
import type { RepositoryDataSource } from "./contracts/models.ts";
import type { PropertyRepository } from "./contracts/property-repository.ts";
import { createMockPropertyRepository } from "./mock/property-repository.ts";
import { createSupabasePropertyRepository } from "./supabase/property-repository.ts";

export type ModuleName =
  | "hotel-settings"
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
  if (dataMode === "hybrid") return moduleName === "hotel-settings" ? "supabase" : "mock";
  return "supabase";
}

export function createRepositoryRegistry(input?: {
  environment?: AppEnvironment;
  propertyRepository?: PropertyRepository;
}) {
  const environment = input?.environment ?? parseAppEnvironment();
  const propertySource = dataSourceForModule("hotel-settings", environment.dataMode);
  const property = input?.propertyRepository ?? (
    propertySource === "supabase"
      ? createSupabasePropertyRepository(createBrowserSupabaseClient(environment), environment.supabaseUrl!)
      : createMockPropertyRepository()
  );
  return { environment, property, dataSourceForModule: (moduleName: ModuleName) => dataSourceForModule(moduleName, environment.dataMode) };
}
