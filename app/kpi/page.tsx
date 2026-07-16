import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function KpiAndTargetsPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="KPI 与目标"
        englishTitle="KPI & Target Management"
        managementQuestion="当前月、季度与年度是否处于可信的目标轨迹上？"
        explanation="当前没有经过确认的 KPI 实际、完整分母、目标版本或培训运营来源，因此无法计算完成率、差距、所需速度、预测结果或培训健康分。原型目标与演示数值不在生产体验中展示。"
        requiredFacts={[
          "经授权确认的酒店级与部门级目标版本",
          "目标适用期间、口径、分子与分母",
          "已完成训练、出勤、反馈与员工范围事实",
          "已确认的未来计划与场次贡献",
          "来源更新时间、完整性与排除项",
        ]}
        availableNow={[
          "员工、部门与职位基础可用于后续建立可靠分母",
          "本页只说明接入边界，不生成目标实际或预测",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
