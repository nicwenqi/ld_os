"use client";

import { UnavailableOperationalPage } from "../../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentAttendanceFeedbackPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="出勤与反馈"
        englishTitle="Attendance & feedback"
        managementQuestion="本部门哪些场次还需要关闭出勤或跟进反馈？"
        explanation="签到、出勤关闭与反馈回收来源尚未接入。缺失记录不会被显示为零，也不会产生虚构完成率。"
        requiredFacts={["受部门范围约束的场次", "签到与出勤关闭记录", "有效反馈提交与样本范围"]}
        returnHref="/department"
        returnLabel="返回部门工作台"
      />
    </ProtectedAppProviders>
  );
}
