import type { EffectiveRole } from "../repositories/contracts/auth-repository.ts";

export type NavigationAvailability = "foundation" | "unavailable";
export type NavigationItem = {
  zh: string;
  en: string;
  href: string;
  availability: NavigationAvailability;
};
export type NavigationGroup = {
  label: string;
  en: string;
  collapsible?: boolean;
  items: NavigationItem[];
};

const managerGroups: NavigationGroup[] = [
  {
    label: "日常运营",
    en: "Daily operations",
    items: [
      item("运营工作台", "Operations home", "/", "foundation"),
      item("培训日历", "Training calendar", "/calendar", "unavailable"),
      item("培训场次", "Training sessions", "/sessions", "foundation"),
      item("出勤与反馈", "Attendance & feedback", "/attendance-feedback", "foundation"),
      item("员工", "Employees", "/people", "foundation"),
      item("干预与提醒", "Interventions & reminders", "/interventions", "unavailable"),
    ],
  },
  {
    label: "周期复盘",
    en: "Periodic review",
    items: [
      item("培训要求", "Learning requirements", "/requirements", "foundation"),
      item("培训计划", "Training plans", "/plans", "foundation"),
      item("部门表现", "Department performance", "/department-performance", "unavailable"),
      item("KPI 与目标", "KPI & targets", "/kpi", "unavailable"),
      item("课程成效", "Course effectiveness", "/effectiveness", "unavailable"),
      item("数据质量", "Data quality", "/data-quality", "foundation"),
    ],
  },
  {
    label: "管理设置",
    en: "Administration",
    collapsible: true,
    items: [
      item("员工资料更新", "Employee data update", "/import", "foundation"),
      item("组织架构", "Organization", "/organization", "foundation"),
      item("职位体系", "Positions", "/positions", "foundation"),
      item("账号与部门授权", "Accounts & department scope", "/accounts", "foundation"),
      item("酒店设置", "Hotel settings", "/settings/hotel", "foundation"),
      item("酒店启用", "Hotel activation", "/initialize", "foundation"),
    ],
  },
];

const departmentGroups: NavigationGroup[] = [
  {
    label: "部门运营",
    en: "Department operations",
    items: [
      item("部门工作台", "Department home", "/department", "foundation"),
      item("培训要求", "Learning requirements", "/department/requirements", "foundation"),
      item("培训日历", "Training calendar", "/department/calendar", "unavailable"),
      item("培训场次", "Training sessions", "/department/sessions", "foundation"),
      item("本部门员工", "Department employees", "/department/employees", "foundation"),
      item("出勤与反馈", "Attendance & feedback", "/department/attendance-feedback", "foundation"),
      item("补训与提醒", "Make-up & reminders", "/department/remediation", "unavailable"),
      item("部门数据", "Department data", "/department/data", "unavailable"),
    ],
  },
];

export function navigationForRole(role: EffectiveRole): { groups: NavigationGroup[] } {
  if (role === "property_ld_manager") return { groups: managerGroups };
  if (role === "department_training_responsible") return { groups: departmentGroups };
  return { groups: [] };
}

function item(zh: string, en: string, href: string, availability: NavigationAvailability): NavigationItem {
  return { zh, en, href, availability };
}
