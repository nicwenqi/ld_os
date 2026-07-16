"use client";

import { UnavailableOperationalPage } from "../../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../../providers";

export default function DepartmentDataPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="部门数据"
        englishTitle="Department training data"
        managementQuestion="本部门本期培训进度是否沿目标轨迹发展？"
        explanation="培训时数、完成轨迹、目标差距和趋势当前无法计算。页面不会用酒店级、其他部门或演示事实补齐。"
        requiredFacts={["部门目标与有效分母", "完成的培训事实", "可信出勤证据与计算口径"]}
        returnHref="/department"
        returnLabel="返回部门工作台"
      />
    </ProtectedAppProviders>
  );
}
