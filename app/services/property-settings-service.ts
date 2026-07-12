import type { HotelPropertyRecord } from "../repositories/contracts/models.ts";

export type InitializationStep = {
  key: "identity" | "rules" | "branding" | "property-context";
  label: string;
  detail: string;
  complete: boolean;
};

export function getInitializationSteps(record: HotelPropertyRecord): InitializationStep[] {
  const identity = record.identity;
  return [
    {
      key: "property-context",
      label: "酒店上下文已建立",
      detail: "Synthetic tenant · property · hostname",
      complete: Boolean(identity.id && identity.tenantId),
    },
    {
      key: "identity",
      label: "基本信息完整",
      detail: "中英文名称、代码、品牌、城市与时区",
      complete: [identity.nameZh, identity.nameEn, identity.code, identity.brand, identity.city, identity.timezone].every(Boolean),
    },
    {
      key: "rules",
      label: "业务规则已确认",
      detail: "新员工、试用期、状态来源、CTC / GTC",
      complete: record.settings.newEmployeeDays > 0,
    },
    {
      key: "branding",
      label: "酒店标识已上传",
      detail: "公开品牌资产 · 替换版本保留 30 天",
      complete: Boolean(record.currentLogo),
    },
  ];
}
