export type RepositoryDataSource = "mock" | "supabase" | "neon" | "unavailable";

export type PropertyContext = {
  tenantId: string;
  propertyId: string;
  hostname: string;
  nameZh: string;
  nameEn: string;
  shortName: string;
  logoUrl: string | null;
};

export type PropertyIdentity = {
  id: string;
  tenantId: string;
  code: string;
  nameZh: string;
  nameEn: string;
  shortName: string;
  brand: string;
  city: string;
  countryRegion: string;
  timezone: string;
  defaultLanguage: string;
  status: "initializing" | "active" | "inactive";
  updatedAt: string;
};

export type PropertySettings = {
  id: string;
  propertyId: string;
  newEmployeeDays: number;
  probationFieldMeaning: "probation_end_date" | "confirmation_date" | "unused";
  employeeStatusSource: "excel_import" | "manual" | "future_hris";
  ctcMandatory: boolean;
  gtcMandatory: boolean;
  initializationState: "not_started" | "in_progress" | "ready";
  version: number;
  updatedAt: string;
};

export type PropertyBrandAsset = {
  id: string;
  propertyId: string;
  objectPath: string;
  publicUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  byteSize: number;
  version: number;
  isCurrent: boolean;
  retentionUntil: string | null;
};

export type HotelPropertyRecord = {
  identity: PropertyIdentity;
  settings: PropertySettings;
  currentLogo: PropertyBrandAsset | null;
};
