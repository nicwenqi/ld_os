export type WizardStepKey = "identity" | "rules" | "organization" | "positions" | "upload" | "mapping" | "access" | "readiness";
export type WizardProgress = {
  lastActiveStep: number;
  steps: Partial<Record<WizardStepKey, { explicitlyConfirmed?: boolean; warning?: string | null; blockingReason?: string | null }>>;
  completedAt?: string | null;
  state?: "not_started" | "in_progress" | "ready";
};
export type WizardFacts = {
  identity: { nameZh: string; nameEn: string; shortName: string; code: string; brand: string; city: string; countryRegion: string; timezone: string; defaultLanguage: string };
  rules: { newEmployeeDays: number; probationFieldMeaning: string; employeeStatusSource: string; ctcMandatory: boolean; gtcMandatory: boolean };
  activeDepartments: number; activePositions: number; inspectedEmployeeMaster: boolean; unresolvedDepartmentLabels: number; unresolvedPositionLabels: number; activePropertyAdministrator: boolean; progress: WizardProgress;
};
export type WizardStepState = {
  key: WizardStepKey;
  number: number;
  label: string;
  english: string;
  complete: boolean;
  blocked: boolean;
  warning: string | null;
  detail: string;
};

const definitions = [
  { key: "identity", number: 1, label: "酒店信息与规则", english: "Hotel Information & Rules" },
  { key: "organization", number: 2, label: "正式部门", english: "Official Departments" },
  { key: "access", number: 3, label: "管理员账号", english: "Manager Account" },
  { key: "upload", number: 4, label: "员工资料准备", english: "Employee Data Readiness" },
  { key: "readiness", number: 5, label: "启用复核", english: "Activation Review" },
] as const satisfies readonly Omit<WizardStepState, "complete" | "blocked" | "warning" | "detail">[];

export function deriveWizardState(facts: WizardFacts) {
  const identityComplete = Object.values(facts.identity).every(value => Boolean(String(value).trim()));
  const rulesComplete = Number.isInteger(facts.rules.newEmployeeDays) && facts.rules.newEmployeeDays >= 1 && facts.rules.newEmployeeDays <= 365 && Boolean(facts.rules.probationFieldMeaning) && Boolean(facts.rules.employeeStatusSource);
  const minimumReady = identityComplete && rulesComplete && facts.activeDepartments > 0 && facts.activePropertyAdministrator;
  const employeeReady = facts.activePositions > 0
    && facts.inspectedEmployeeMaster
    && facts.unresolvedDepartmentLabels === 0
    && facts.unresolvedPositionLabels === 0;
  const activationCompleted = facts.progress.state === "ready" || Boolean(facts.progress.completedAt);
  const requiresMaintenance = activationCompleted && !minimumReady;
  const completeByKey: Partial<Record<WizardStepKey, boolean>> = {
    identity: identityComplete && rulesComplete,
    organization: facts.activeDepartments > 0,
    access: facts.activePropertyAdministrator,
    upload: employeeReady,
    readiness: activationCompleted,
  };
  const details: Record<(typeof definitions)[number]["key"], string> = {
    identity: identityComplete && rulesComplete ? "酒店身份与业务规则已保存" : "完成酒店身份和必需业务规则",
    organization: facts.activeDepartments > 0 ? `${facts.activeDepartments} 个有效正式部门` : "至少建立一个有效正式部门",
    access: facts.activePropertyAdministrator ? "已找到活动酒店学习与发展经理" : "至少保留一个活动酒店学习与发展经理账号",
    upload: employeeReady
      ? "员工资料、职位与归属准备已就绪"
      : "员工资料准备不会阻塞酒店启用，可在启用后继续",
    readiness: activationCompleted ? "酒店已启用，可随时返回复核" : "复核必需条件并启用酒店",
  };
  const steps = definitions.map(definition => ({
    ...definition,
    complete: Boolean(completeByKey[definition.key]),
    blocked: definition.key !== "upload"
      && !completeByKey[definition.key]
      && Boolean(facts.progress.steps[definition.key]?.blockingReason),
    warning: facts.progress.steps[definition.key]?.warning ?? null,
    detail: details[definition.key],
  }));
  const lastIncompleteStep = !identityComplete || !rulesComplete
    ? 1
    : facts.activeDepartments <= 0
      ? 2
      : !facts.activePropertyAdministrator
        ? 3
        : activationCompleted
          ? 5
          : 5;
  const nextRecommendedAction = recommendation({
    identityComplete,
    rulesComplete,
    hasDepartment: facts.activeDepartments > 0,
    hasManager: facts.activePropertyAdministrator,
    activationCompleted,
    requiresMaintenance,
  });
  const operationalBlockingReasons = [
    facts.activePositions <= 0 && "职位体系尚未准备",
    !facts.inspectedEmployeeMaster && "员工资料尚未完成文件检查",
    facts.unresolvedDepartmentLabels > 0 && "仍有部门归属待确认",
    facts.unresolvedPositionLabels > 0 && "仍有职位归属待确认",
  ].filter((value): value is string => Boolean(value));
  const activationConclusion = activationCompleted
    ? requiresMaintenance
      ? "酒店已启用，部分必需基础条件需要维护"
      : "酒店已启用，启用资料可随时复核"
    : minimumReady
      ? "必需条件已满足，可以启用酒店"
      : "酒店尚未满足启用所需的必需条件";
  return {
    steps,
    ready: activationCompleted || minimumReady,
    operationalReady: minimumReady && employeeReady,
    minimumReady,
    employeeReady,
    activationCompleted,
    requiresMaintenance,
    activationConclusion,
    operationalBlockingReasons,
    lastIncompleteStep,
    completedSteps: steps.filter(step => step.complete),
    progressPercent: Math.round(steps.filter(step => step.complete).length / steps.length * 100),
    nextRecommendedAction,
  };
}

function recommendation(input: {
  identityComplete: boolean;
  rulesComplete: boolean;
  hasDepartment: boolean;
  hasManager: boolean;
  activationCompleted: boolean;
  requiresMaintenance: boolean;
}) {
  if (input.activationCompleted) {
    return input.requiresMaintenance ? "维护酒店启用基础" : "返回运营工作台";
  }
  if (!input.identityComplete || !input.rulesComplete) return "完善酒店信息与业务规则";
  if (!input.hasDepartment) return "建立正式部门";
  if (!input.hasManager) return "确认管理员账号";
  return "完成酒店启用复核";
}
