import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function TrainingPlansPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="培训计划"
        englishTitle="Training Plans"
        managementQuestion="已规划的培训容量是否足以支持本期目标与必要要求？"
        explanation="真实培训计划、目标需求与已确认未来容量尚未连接，因此无法展示计划完成率、剩余需求或计划充分性。系统不会用演示计划暗示酒店已作出安排。"
        requiredFacts={[
          "计划周期、业务目的与批准状态",
          "课程、目标部门、适用员工与必要要求",
          "计划容量、培训资源与拟定时间窗口",
          "计划与目标需求的可解释关联",
          "计划变更与批准记录",
        ]}
        availableNow={[
          "酒店组织、职位与员工主数据可支持未来规划范围",
          "未经批准的设想不得计入已确认未来贡献",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
