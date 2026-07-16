import { UnavailableOperationalPage } from "../components/operations/UnavailableOperationalPage";
import { ProtectedAppProviders } from "../providers";

export default function AttendanceAndFeedbackPage() {
  return (
    <ProtectedAppProviders>
      <UnavailableOperationalPage
        title="出勤与反馈"
        englishTitle="Attendance & Feedback"
        managementQuestion="哪些已发生的培训仍缺少出勤关闭或有效反馈证据？"
        explanation="尚无可信的场次出勤、签到关闭或反馈回收事实。缺少来源不是零出勤或零反馈，因此本页不展示比例、名单、风险或补训建议。"
        requiredFacts={[
          "真实且已发生的培训场次",
          "场次受众与符合条件的员工范围",
          "签到、出勤状态、关闭人与关闭时间",
          "反馈提交、有效样本与问卷版本",
          "修改、补录与异常处理审计记录",
        ]}
        availableNow={[
          "员工主数据可用于后续受限身份匹配",
          "QR 签到和反馈必须使用不透明、过期且绑定场次的令牌",
        ]}
        returnHref="/"
        returnLabel="返回运营工作台"
      />
    </ProtectedAppProviders>
  );
}
