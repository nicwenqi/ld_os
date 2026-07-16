import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function InterventionsPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="干预与提醒"
        englishTitle="Interventions & Reminders"
        managementQuestion="当前哪些可恢复偏差需要谁在什么时间前采取行动？"
        explanation="风险来源、行动所有者与验证生命周期尚未建立。系统不会生成假风险、假提醒或点击后即消失的原型任务，也不会把建议误写成已批准的管理决定。"
        requiredFacts={[
          "由可信事实触发且可解释的运营偏差",
          "严重程度、剩余干预窗口与授权责任人",
          "已批准行动、期限、执行状态与结果",
          "来源事实改变、恢复验证与审计历史",
        ]}
        availableNow={[
          "酒店经理与部门授权基础可用于未来分配责任",
          "训练事实接入前不创建运营风险或提醒",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
