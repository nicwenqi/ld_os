import type {
  HotelPropertyRecord,
  PropertyIdentity,
  PropertySettings,
} from "../repositories/contracts/models.ts";

export type InitializationStep = {
  key: "identity" | "rules" | "branding";
  label: string;
  detail: string;
  complete: boolean;
};

export function getInitializationSteps(record: HotelPropertyRecord): InitializationStep[] {
  const identity = record.identity;
  return [
    {
      key: "identity",
      label: "酒店信息完整",
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
      label: "酒店标识",
      detail: record.currentLogo ? "当前标识已保存" : "可选品牌资产，稍后仍可补充",
      complete: Boolean(record.currentLogo),
    },
  ];
}

type EditableIdentity = Pick<
  PropertyIdentity,
  | "nameZh"
  | "nameEn"
  | "shortName"
  | "code"
  | "brand"
  | "city"
  | "countryRegion"
  | "timezone"
  | "defaultLanguage"
>;

type EditableRules = Pick<
  PropertySettings,
  | "newEmployeeDays"
  | "probationFieldMeaning"
  | "employeeStatusSource"
  | "ctcMandatory"
  | "gtcMandatory"
>;

const identityRequirements: Array<[keyof EditableIdentity, string]> = [
  ["nameZh", "请输入酒店正式中文名称"],
  ["nameEn", "请输入酒店正式英文名称"],
  ["shortName", "请输入酒店显示简称"],
  ["code", "请输入酒店代码"],
  ["brand", "请输入酒店品牌"],
  ["city", "请输入酒店所在城市"],
  ["countryRegion", "请输入国家或地区"],
  ["timezone", "请输入酒店时区"],
  ["defaultLanguage", "请选择默认语言"],
];

export function validatePropertyIdentity(identity: EditableIdentity) {
  for (const [key, message] of identityRequirements) {
    if (!String(identity[key] ?? "").trim()) throw new Error(message);
  }
}

export function validateBusinessRules(rules: EditableRules) {
  if (
    !Number.isInteger(rules.newEmployeeDays)
    || rules.newEmployeeDays < 1
    || rules.newEmployeeDays > 365
  ) {
    throw new Error("新员工定义必须为 1 至 365 天");
  }
  if (!rules.probationFieldMeaning) throw new Error("请选择试用期字段含义");
  if (!rules.employeeStatusSource) throw new Error("请选择员工状态来源");
}
