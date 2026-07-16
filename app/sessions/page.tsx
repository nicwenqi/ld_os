import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function TrainingSessionsPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="培训场次"
        englishTitle="Training Sessions"
        managementQuestion="哪些场次即将发生、需要处理，或尚未满足交付条件？"
        explanation="真实培训场次尚未接入。系统不会显示虚构课程、培训师、时间、场地、人数或发布状态，也不会提供仅产生提示信息的创建与发布动作。"
        requiredFacts={[
          "真实课程与已批准培训计划",
          "场次时间、场地、容量、培训师与目标受众",
          "草稿、发布、变更、取消与关闭状态",
          "创建人、授权范围与完整审计记录",
        ]}
        availableNow={[
          "正式部门、职位与员工记录可作为后续受众范围",
          "场次持久化与权限校验完成前不开放创建操作",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
