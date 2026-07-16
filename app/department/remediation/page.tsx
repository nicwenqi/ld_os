"use client";

import { UnavailableOperationalPage } from "../../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentRemediationPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="补训与提醒"
        englishTitle="Make-up training & reminders"
        managementQuestion="本部门当前有哪些可执行的补训或提醒行动？"
        explanation="没有可信场次、出勤例外和行动状态时，系统不会生成假任务或让按钮暗示提醒已经发送。"
        requiredFacts={["可追溯的培训例外", "可执行的部门对象", "负责人、截止日期与行动状态"]}
        returnHref="/department"
        returnLabel="返回部门工作台"
      />
    </ProtectedAppProviders>
  );
}
