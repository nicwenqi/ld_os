import type { RiskItem } from "../types/domain.ts";
export const risks: RiskItem[] = [
  {id:"risk-1",titleZh:"礼宾部 3 名员工消防培训逾期",severity:"critical",departmentId:"concierge",recommendationZh:"创建本周补训场次"},
  {id:"risk-2",titleZh:"宴会部反馈回收率低于预警线",severity:"warning",departmentId:"banquet",recommendationZh:"向未反馈员工发送提醒"},
  {id:"risk-3",titleZh:"前台新员工完成进度落后",severity:"warning",departmentId:"front-desk",recommendationZh:"检查入职培训分配"},
];
