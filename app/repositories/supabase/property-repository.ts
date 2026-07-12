import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PropertyRepository,
  SaveBusinessRulesInput,
  SavePropertyIdentityInput,
  UploadPropertyLogoInput,
} from "../contracts/property-repository.ts";
import type {
  HotelPropertyRecord,
  PropertyBrandAsset,
  PropertyContext,
  PropertyIdentity,
  PropertySettings,
} from "../contracts/models.ts";

type PropertySupabaseClient = Pick<SupabaseClient, "rpc" | "from" | "storage">;

export function createSupabasePropertyRepository(
  client: PropertySupabaseClient,
  supabaseOrigin: string,
): PropertyRepository {
  return {
    async resolveContext(hostname): Promise<PropertyContext | null> {
      const { data, error } = await client.rpc("resolve_property_context", { p_hostname: hostname });
      if (error) throw new Error(`无法识别酒店域名：${error.message}`);
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;
      return {
        tenantId: row.tenant_id,
        propertyId: row.property_id,
        hostname: row.hostname,
        nameZh: row.name_zh,
        nameEn: row.name_en,
        shortName: row.short_name,
        logoUrl: absolutePublicLogoUrl(supabaseOrigin, row.logo_url),
      };
    },

    async getProperty(propertyId) {
      const [{ data: property, error: propertyError }, { data: settings, error: settingsError }, { data: asset, error: assetError }] = await Promise.all([
        client.from("properties").select("id,tenant_id,code,name_zh,name_en,short_name,brand,city,country_region,timezone,default_language,status,updated_at").eq("id", propertyId).single(),
        client.from("property_settings").select("id,property_id,new_employee_days,probation_field_meaning,employee_status_source,ctc_mandatory,gtc_mandatory,initialization_state,version,updated_at").eq("property_id", propertyId).single(),
        client.from("property_brand_assets").select("id,property_id,object_path,mime_type,byte_size,version,is_current,retention_until").eq("property_id", propertyId).eq("is_current", true).maybeSingle(),
      ]);
      if (propertyError) throw new Error(`无法读取酒店基本信息：${propertyError.message}`);
      if (settingsError) throw new Error(`无法读取酒店业务规则：${settingsError.message}`);
      if (assetError) throw new Error(`无法读取酒店标识：${assetError.message}`);
      return mapPropertyRecord(property, settings, asset, supabaseOrigin);
    },

    async saveIdentity(input: SavePropertyIdentityInput) {
      const { data, error } = await client.from("properties").update({
        code: input.code.trim().toLowerCase(),
        name_zh: required(input.nameZh, "中文酒店名称"),
        name_en: required(input.nameEn, "英文酒店名称"),
        short_name: required(input.shortName, "显示简称"),
        brand: required(input.brand, "品牌"),
        city: required(input.city, "城市"),
        country_region: required(input.countryRegion, "国家或地区"),
        timezone: required(input.timezone, "时区"),
        default_language: required(input.defaultLanguage, "默认语言"),
      }).eq("id", input.propertyId).eq("updated_at", input.expectedUpdatedAt).select("id").maybeSingle();
      if (error) throw new Error(`保存基本信息失败：${error.message}`);
      if (!data) throw new Error("酒店资料已被更新，请刷新后重试");
      return this.getProperty(input.propertyId);
    },

    async saveBusinessRules(input: SaveBusinessRulesInput) {
      if (!Number.isInteger(input.newEmployeeDays) || input.newEmployeeDays < 1 || input.newEmployeeDays > 365)
        throw new Error("新员工定义必须在 1 至 365 天之间");
      const { data, error } = await client.from("property_settings").update({
        new_employee_days: input.newEmployeeDays,
        probation_field_meaning: input.probationFieldMeaning,
        employee_status_source: input.employeeStatusSource,
        ctc_mandatory: input.ctcMandatory,
        gtc_mandatory: input.gtcMandatory,
      }).eq("property_id", input.propertyId).eq("version", input.expectedVersion).select("id").maybeSingle();
      if (error) throw new Error(`保存业务规则失败：${error.message}`);
      if (!data) throw new Error("酒店资料已被更新，请刷新后重试");
      return this.getProperty(input.propertyId);
    },

    async uploadLogo(input: UploadPropertyLogoInput) {
      const extension = extensionForMime(input.file.type);
      if (!extension) throw new Error("仅支持 PNG、JPEG 或 WebP 酒店标识");
      if (input.file.size < 1 || input.file.size > 2 * 1024 * 1024) throw new Error("酒店标识必须小于 2 MB");
      const { data: latest, error: latestError } = await client.from("property_brand_assets")
        .select("version").eq("property_id", input.propertyId).order("version", { ascending: false }).limit(1).maybeSingle();
      if (latestError) throw new Error(`无法准备酒店标识版本：${latestError.message}`);
      const version = (latest?.version ?? 0) + 1;
      const assetId = crypto.randomUUID();
      const objectPath = buildBrandAssetPath({ ...input, assetId, version, mimeType: input.file.type });
      const bucket = client.storage.from("property-brand-assets");
      const { error: uploadError } = await bucket.upload(objectPath, input.file, { contentType: input.file.type, upsert: false });
      if (uploadError) throw new Error(`上传酒店标识失败：${uploadError.message}`);
      const { data, error } = await client.from("property_brand_assets").insert({
        id: assetId,
        tenant_id: input.tenantId,
        property_id: input.propertyId,
        object_path: objectPath,
        original_file_name: input.file.name,
        mime_type: input.file.type,
        byte_size: input.file.size,
        version,
      }).select("id,property_id,object_path,mime_type,byte_size,version,is_current,retention_until").single();
      if (error) {
        await bucket.remove([objectPath]);
        throw new Error(`登记酒店标识失败：${error.message}`);
      }
      return mapBrandAsset(data, supabaseOrigin);
    },

    async cleanupExpiredLogos(propertyId) {
      const { data, error } = await client.from("property_brand_assets")
        .select("id,object_path").eq("property_id", propertyId).eq("is_current", false).lte("retention_until", new Date().toISOString());
      if (error) throw new Error(`无法读取到期酒店标识：${error.message}`);
      if (!data?.length) return 0;
      const bucket = client.storage.from("property-brand-assets");
      const { error: storageError } = await bucket.remove(data.map(row => row.object_path));
      if (storageError) throw new Error(`清理到期酒店标识失败：${storageError.message}`);
      const { error: deleteError } = await client.from("property_brand_assets").delete().in("id", data.map(row => row.id));
      if (deleteError) throw new Error(`清理酒店标识记录失败：${deleteError.message}`);
      return data.length;
    },
  };
}

export function buildBrandAssetPath(input: {
  tenantId: string;
  propertyId: string;
  assetId: string;
  version: number;
  mimeType: string;
}): string {
  const extension = extensionForMime(input.mimeType);
  if (!extension) throw new Error("仅支持 PNG、JPEG 或 WebP 酒店标识");
  return `${input.tenantId}/${input.propertyId}/branding/${input.assetId}/logo-v${input.version}.${extension}`;
}

export function absolutePublicLogoUrl(origin: string, path: string | null): string | null {
  if (!path) return null;
  return `${origin.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function mapPropertyRecord(property: any, settings: any, asset: any, origin: string): HotelPropertyRecord {
  const identity: PropertyIdentity = {
    id: property.id,
    tenantId: property.tenant_id,
    code: property.code,
    nameZh: property.name_zh,
    nameEn: property.name_en,
    shortName: property.short_name ?? property.name_zh,
    brand: property.brand ?? "",
    city: property.city ?? "",
    countryRegion: property.country_region,
    timezone: property.timezone,
    defaultLanguage: property.default_language,
    status: property.status,
    updatedAt: property.updated_at,
  };
  const propertySettings: PropertySettings = {
    id: settings.id,
    propertyId: settings.property_id,
    newEmployeeDays: settings.new_employee_days,
    probationFieldMeaning: settings.probation_field_meaning,
    employeeStatusSource: settings.employee_status_source,
    ctcMandatory: settings.ctc_mandatory,
    gtcMandatory: settings.gtc_mandatory,
    initializationState: settings.initialization_state,
    version: Number(settings.version),
    updatedAt: settings.updated_at,
  };
  return { identity, settings: propertySettings, currentLogo: asset ? mapBrandAsset(asset, origin) : null };
}

function mapBrandAsset(asset: any, origin: string): PropertyBrandAsset {
  const relative = `/storage/v1/object/public/property-brand-assets/${asset.object_path}`;
  return {
    id: asset.id,
    propertyId: asset.property_id,
    objectPath: asset.object_path,
    publicUrl: absolutePublicLogoUrl(origin, relative)!,
    mimeType: asset.mime_type,
    byteSize: Number(asset.byte_size),
    version: asset.version,
    isCurrent: asset.is_current,
    retentionUntil: asset.retention_until,
  };
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label}不能为空`);
  return trimmed;
}

function extensionForMime(mime: string): "png" | "jpg" | "webp" | null {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return null;
}
