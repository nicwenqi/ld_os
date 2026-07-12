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

const tenantId = "10000000-0000-0000-0000-000000000001";
const propertyId = "20000000-0000-0000-0000-000000000011";
const hostname = "training-demo.example.test";
const publicStorageOrigin = "https://storage.example.test/storage/v1/object/public/property-brand-assets";

export function createMockPropertyRepository(): PropertyRepository {
  let identity: PropertyIdentity = {
    id: propertyId,
    tenantId,
    code: "DEMO-01",
    nameZh: "示范酒店",
    nameEn: "Synthetic Hotel",
    shortName: "示范酒店",
    brand: "Demo Hospitality",
    city: "测试城市",
    countryRegion: "CN",
    timezone: "Asia/Shanghai",
    defaultLanguage: "zh-CN",
    status: "initializing",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
  let settings: PropertySettings = {
    id: "30000000-0000-0000-0000-000000000011",
    propertyId,
    newEmployeeDays: 90,
    probationFieldMeaning: "confirmation_date",
    employeeStatusSource: "manual",
    ctcMandatory: true,
    gtcMandatory: true,
    initializationState: "in_progress",
    version: 1,
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
  const assets: PropertyBrandAsset[] = [];

  const snapshot = (): HotelPropertyRecord => ({
    identity: { ...identity },
    settings: { ...settings },
    currentLogo: assets.find(asset => asset.isCurrent) ? { ...assets.find(asset => asset.isCurrent)! } : null,
  });

  return {
    async resolveContext(candidate): Promise<PropertyContext | null> {
      if (candidate.trim().toLowerCase() !== hostname) return null;
      const currentLogo = assets.find(asset => asset.isCurrent);
      return {
        tenantId,
        propertyId,
        hostname,
        nameZh: identity.nameZh,
        nameEn: identity.nameEn,
        shortName: identity.shortName,
        logoUrl: currentLogo?.publicUrl ?? null,
      };
    },

    async getProperty(candidatePropertyId) {
      if (candidatePropertyId !== propertyId) throw new Error("未找到当前酒店资料");
      return snapshot();
    },

    async saveIdentity(input: SavePropertyIdentityInput) {
      if (input.propertyId !== propertyId) throw new Error("未找到当前酒店资料");
      if (input.expectedUpdatedAt !== identity.updatedAt) throw new Error("酒店资料已被更新，请刷新后重试");
      identity = {
        ...identity,
        code: required(input.code, "酒店代码"),
        nameZh: required(input.nameZh, "中文酒店名称"),
        nameEn: required(input.nameEn, "英文酒店名称"),
        shortName: required(input.shortName, "显示简称"),
        brand: required(input.brand, "品牌"),
        city: required(input.city, "城市"),
        countryRegion: required(input.countryRegion, "国家或地区"),
        timezone: required(input.timezone, "时区"),
        defaultLanguage: required(input.defaultLanguage, "默认语言"),
        updatedAt: new Date().toISOString(),
      };
      return snapshot();
    },

    async saveBusinessRules(input: SaveBusinessRulesInput) {
      if (input.propertyId !== propertyId) throw new Error("未找到当前酒店资料");
      if (input.expectedVersion !== settings.version) throw new Error("酒店资料已被更新，请刷新后重试");
      if (!Number.isInteger(input.newEmployeeDays) || input.newEmployeeDays < 1 || input.newEmployeeDays > 365)
        throw new Error("新员工定义必须在 1 至 365 天之间");
      settings = {
        ...settings,
        newEmployeeDays: input.newEmployeeDays,
        probationFieldMeaning: input.probationFieldMeaning,
        employeeStatusSource: input.employeeStatusSource,
        ctcMandatory: input.ctcMandatory,
        gtcMandatory: input.gtcMandatory,
        version: settings.version + 1,
        updatedAt: new Date().toISOString(),
      };
      return snapshot();
    },

    async uploadLogo(input: UploadPropertyLogoInput) {
      if (input.tenantId !== tenantId || input.propertyId !== propertyId) throw new Error("无权写入其他酒店的品牌路径");
      const extension = extensionForMime(input.file.type);
      if (!extension) throw new Error("仅支持 PNG、JPEG 或 WebP 酒店标识");
      if (input.file.size > 2 * 1024 * 1024) throw new Error("酒店标识不能超过 2 MB");
      const now = new Date();
      for (const asset of assets) {
        if (!asset.isCurrent) continue;
        asset.isCurrent = false;
        asset.retentionUntil = new Date(now.getTime() + 30 * 86400000).toISOString();
      }
      const id = crypto.randomUUID();
      const version = assets.length + 1;
      const objectPath = `${tenantId}/${propertyId}/branding/${id}/logo-v${version}.${extension}`;
      const asset: PropertyBrandAsset = {
        id,
        propertyId,
        objectPath,
        publicUrl: `${publicStorageOrigin}/${objectPath}`,
        mimeType: input.file.type as PropertyBrandAsset["mimeType"],
        byteSize: input.file.size,
        version,
        isCurrent: true,
        retentionUntil: null,
      };
      assets.push(asset);
      return { ...asset };
    },

    async cleanupExpiredLogos(candidatePropertyId) {
      if (candidatePropertyId !== propertyId) throw new Error("未找到当前酒店资料");
      const now = Date.now();
      const expired = assets.filter(asset => !asset.isCurrent && asset.retentionUntil && Date.parse(asset.retentionUntil) <= now);
      for (const asset of expired) assets.splice(assets.indexOf(asset), 1);
      return expired.length;
    },
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
