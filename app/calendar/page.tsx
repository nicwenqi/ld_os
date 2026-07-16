import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function TrainingCalendarPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="培训日历"
        englishTitle="Training Operations Calendar"
        managementQuestion="未来培训活动是否足以支持本期目标，并且已经具备可执行条件？"
        explanation="真实培训计划与场次尚未接入，因此无法展示酒店日历、课程、培训师、场地、受众或场次状态。创建和发布功能将在训练运营事实具备持久化与授权边界后开放。"
        requiredFacts={[
          "已批准的培训计划与计划周期",
          "真实培训场次、日期、时间与状态",
          "课程、培训师、场地、容量与授权受众",
          "取消、变更与发布状态的可追溯记录",
        ]}
        availableNow={[
          "酒店身份与业务规则可在酒店设置中维护",
          "正式部门、职位与员工主数据可用于后续受众范围",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
