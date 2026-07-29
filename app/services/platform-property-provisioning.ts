import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type PropertyProvisioningDraft = {
  tenantId: string;
  propertyCode: string;
  preliminaryNameZh: string;
  preliminaryNameEn: string;
  brand: string;
  city: string;
  countryRegion: string;
  timezone: string;
  defaultLanguage: string;
  hostname: string;
  managerLoginId: string;
  managerDisplayName: string;
  temporaryPassword: string;
};

export type NormalizedPropertyProvisioningDraft = Omit<PropertyProvisioningDraft, "temporaryPassword">;
export type PropertyProvisioningPreview = { token: string; expiresAt: string; normalized: NormalizedPropertyProvisioningDraft };
type PreviewOptions = { actorUserId: string; secret: string; now?: Date };
type PreviewPayload = { version: 1; actorUserId: string; expiresAt: string; normalized: NormalizedPropertyProvisioningDraft; passwordHash: string };
const previewTtlMs = 15 * 60 * 1000;

export function preparePropertyProvisioningPreview(draft: PropertyProvisioningDraft, options: PreviewOptions): PropertyProvisioningPreview {
  const normalized = normalizePropertyProvisioningDraft(draft);
  const expiresAt = new Date((options.now ?? new Date()).getTime() + previewTtlMs).toISOString();
  const payload: PreviewPayload = { version: 1, actorUserId: required(options.actorUserId, "平台操作人无效"), expiresAt, normalized, passwordHash: sha256(draft.temporaryPassword) };
  return { token: sign(payload, options.secret), expiresAt, normalized };
}

export function verifyPropertyProvisioningPreview(token: string, draft: PropertyProvisioningDraft, options: PreviewOptions): NormalizedPropertyProvisioningDraft {
  const payload = verify(token, options.secret);
  if (payload.actorUserId !== required(options.actorUserId, "平台操作人无效")) throw new Error("预览仅可由原平台操作人确认");
  if (Date.parse(payload.expiresAt) <= (options.now ?? new Date()).getTime()) throw new Error("预览已过期，请重新检查后确认");
  const normalized = normalizePropertyProvisioningDraft(draft);
  if (stable(payload.normalized) !== stable(normalized) || payload.passwordHash !== sha256(draft.temporaryPassword)) throw new Error("预览内容已变化，请重新检查后确认");
  return normalized;
}

export function normalizePropertyProvisioningDraft(draft: PropertyProvisioningDraft): NormalizedPropertyProvisioningDraft {
  const tenantId = required(draft.tenantId, "请选择有效的 Tenant 标识");
  if (!uuid.test(tenantId)) throw new Error("Tenant 标识格式无效");
  const propertyCode = required(draft.propertyCode, "请输入 Property code").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(propertyCode)) throw new Error("Property code 仅支持小写字母、数字和连字符");
  const hostname = required(draft.hostname, "请输入酒店域名").toLowerCase();
  if (!hostnamePattern.test(hostname)) throw new Error("酒店域名格式无效");
  const timezone = required(draft.timezone, "请选择时区");
  try { Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new Error("时区无效"); }
  const defaultLanguage = required(draft.defaultLanguage, "请选择默认语言");
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(defaultLanguage)) throw new Error("默认语言格式无效");
  const managerLoginId = required(draft.managerLoginId, "请输入经理用户 ID");
  if (!/^[A-Za-z0-9._-]{3,80}$/.test(managerLoginId)) throw new Error("经理用户 ID 仅支持字母、数字、点、下划线和连字符");
  const temporaryPassword = required(draft.temporaryPassword, "请输入临时密码");
  if (temporaryPassword.length < 12) throw new Error("临时密码至少需要 12 位");
  return {
    tenantId, propertyCode,
    preliminaryNameZh: required(draft.preliminaryNameZh, "请输入酒店中文名称"),
    preliminaryNameEn: required(draft.preliminaryNameEn, "请输入酒店英文名称"),
    brand: required(draft.brand, "请输入品牌名称"), city: required(draft.city, "请输入城市"),
    countryRegion: required(draft.countryRegion, "请输入国家或地区").toUpperCase(), timezone, defaultLanguage,
    hostname, managerLoginId, managerDisplayName: required(draft.managerDisplayName, "请输入首位学习与发展经理姓名"),
  };
}

function sign(payload: PreviewPayload, secret: string) {
  const body = Buffer.from(stable(payload), "utf8").toString("base64url");
  return `${body}.${createHmac("sha256", required(secret, "预览签名不可用")).update(body).digest("base64url")}`;
}
function verify(token: string, secret: string): PreviewPayload {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("预览凭证无效");
  const expected = createHmac("sha256", required(secret, "预览签名不可用")).update(body).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("预览凭证无效");
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PreviewPayload;
    if (parsed.version !== 1 || !parsed.normalized || !parsed.passwordHash || !parsed.expiresAt) throw new Error();
    return parsed;
  } catch { throw new Error("预览凭证无效"); }
}
function required(value: string | undefined, message: string) { const normalized = value?.trim(); if (!normalized) throw new Error(message); return normalized; }
function stable(value: unknown) { return JSON.stringify(value); }
function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
