"use client";

import { UnavailableOperationalPage } from "../../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentSessionsPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="培训场次"
        englishTitle="Department training sessions"
        managementQuestion="哪些场次属于当前授权部门并且需要本部门执行？"
        explanation="真实培训场次持久化尚未建立。当前不会显示虚构培训师、场地、受众、容量或场次状态。"
        requiredFacts={["培训计划与课程", "已发布场次", "培训师、场地、容量与部门受众"]}
        returnHref="/department"
        returnLabel="返回部门工作台"
      />
    </ProtectedAppProviders>
  );
}
