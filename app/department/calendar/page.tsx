"use client";

import { UnavailableOperationalPage } from "../../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentCalendarPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="培训日历"
        englishTitle="Department training calendar"
        managementQuestion="本部门近期有哪些已发布、可执行的培训安排？"
        explanation="当前没有已连接并可验证的部门培训场次来源，因此不显示演示日历、虚构场次或把空白解释为没有安排。"
        requiredFacts={["已发布培训场次", "场次日期与状态", "培训受众与授权部门归属"]}
        returnHref="/department"
        returnLabel="返回部门工作台"
      />
    </ProtectedAppProviders>
  );
}
