import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function DepartmentPerformancePage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="部门表现"
        englishTitle="Department Training Performance"
        managementQuestion="哪些部门领先、在轨、放缓、存在风险或缺少可信数据？"
        explanation="部门组织基础已经可用，但真实培训计划、场次、出勤、反馈和目标实际尚未接入。系统不会把部门员工数量解释为培训表现，也不会生成虚构排名或健康结论。"
        requiredFacts={[
          "有效部门范围与纳入计算的员工分母",
          "部门目标、完成事实与可比期间",
          "计划、场次、出勤、反馈及必要培训覆盖",
          "来源完整性、更新时间与组织变更影响",
        ]}
        availableNow={[
          "正式部门树及其后代关系可用于未来聚合",
          "员工部门归属可用于未来建立授权分母",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
