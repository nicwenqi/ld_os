import type { HotelPropertyRecord, PropertyBrandAsset, PropertyContext } from "./models.ts";

export type SavePropertyIdentityInput = {
  propertyId: string;
  expectedUpdatedAt: string;
  code: string;
  nameZh: string;
  nameEn: string;
  shortName: string;
  brand: string;
  city: string;
  countryRegion: string;
  timezone: string;
  defaultLanguage: string;
};

export type SaveBusinessRulesInput = {
  propertyId: string;
  expectedVersion: number;
  newEmployeeDays: number;
  probationFieldMeaning: "probation_end_date" | "confirmation_date" | "unused";
  employeeStatusSource: "excel_import" | "manual" | "future_hris";
  ctcMandatory: boolean;
  gtcMandatory: boolean;
};

export type UploadPropertyLogoInput = {
  tenantId: string;
  propertyId: string;
  file: File;
};

export interface PropertyRepository {
  resolveContext(hostname: string): Promise<PropertyContext | null>;
  getProperty(propertyId: string): Promise<HotelPropertyRecord>;
  saveIdentity(input: SavePropertyIdentityInput): Promise<HotelPropertyRecord>;
  saveBusinessRules(input: SaveBusinessRulesInput): Promise<HotelPropertyRecord>;
  uploadLogo(input: UploadPropertyLogoInput): Promise<PropertyBrandAsset>;
  cleanupExpiredLogos(propertyId: string): Promise<number>;
}
