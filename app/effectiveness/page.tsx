import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function CourseEffectivenessPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="课程成效"
        englishTitle="Course Effectiveness"
        managementQuestion="哪些课程与培训师正在产生可信成效，哪些需要复核？"
        explanation="课程、有效反馈样本、满意度与岗位应用证据尚未连接。系统不会用演示课程、虚构评分或推算的投入产出替代真实酒店结果。"
        requiredFacts={[
          "真实课程版本、目标受众与培训目的",
          "已完成场次和有效出席记录",
          "可追溯的反馈问卷、样本量与回收范围",
          "经确认的满意度、应用或后续验证证据",
          "课程与培训师评价的适用期间",
        ]}
        availableNow={[
          "组织与员工基础可支持未来按授权范围分析",
          "反馈来源不存在时，满意度保持为无法计算",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
