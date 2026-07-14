export type WizardStepKey = "identity" | "rules" | "organization" | "positions" | "upload" | "mapping" | "access" | "readiness";
export type WizardProgress = { lastActiveStep: number; steps: Partial<Record<WizardStepKey, { explicitlyConfirmed?: boolean; warning?: string | null; blockingReason?: string | null }>> };
export type WizardFacts = {
  identity: { nameZh: string; nameEn: string; shortName: string; code: string; brand: string; city: string; countryRegion: string; timezone: string; defaultLanguage: string };
  rules: { newEmployeeDays: number; probationFieldMeaning: string; employeeStatusSource: string; ctcMandatory: boolean; gtcMandatory: boolean };
  activeDepartments: number; activePositions: number; inspectedEmployeeMaster: boolean; unresolvedDepartmentLabels: number; unresolvedPositionLabels: number; activePropertyAdministrator: boolean; progress: WizardProgress;
};
export type WizardStepState = { key: WizardStepKey; number: number; label: string; english: string; complete: boolean; blocked: boolean; warning: string | null };

const definitions: readonly Omit<WizardStepState, "complete" | "blocked" | "warning">[] = [
  { key: "identity", number: 1, label: "酒店基本信息", english: "Hotel Identity" }, { key: "rules", number: 2, label: "业务规则", english: "Business Rules" },
  { key: "organization", number: 3, label: "正式组织架构", english: "Official Organization" }, { key: "positions", number: 4, label: "职位体系", english: "Positions" },
  { key: "upload", number: 5, label: "上传员工数据", english: "Upload Employee Data" }, { key: "mapping", number: 6, label: "部门与职位认领", english: "Claim and Mapping" },
  { key: "access", number: 7, label: "管理员与权限", english: "Administrators and Access" }, { key: "readiness", number: 8, label: "完成检查", english: "Readiness Review" },
];

export function deriveWizardState(facts: WizardFacts) {
  const identityComplete = Object.values(facts.identity).every(value => Boolean(String(value).trim()));
  const rulesComplete = Number.isInteger(facts.rules.newEmployeeDays) && facts.rules.newEmployeeDays >= 1 && facts.rules.newEmployeeDays <= 365 && Boolean(facts.rules.probationFieldMeaning) && Boolean(facts.rules.employeeStatusSource);
  const mappingBlocked = facts.unresolvedDepartmentLabels + facts.unresolvedPositionLabels > 0;
  const explicit = (key: WizardStepKey) => Boolean(facts.progress.steps[key]?.explicitlyConfirmed);
  const complete: Record<WizardStepKey, boolean> = {
    identity: identityComplete, rules: rulesComplete, organization: facts.activeDepartments > 0 && explicit("organization"), positions: facts.activePositions > 0 && explicit("positions"),
    upload: facts.inspectedEmployeeMaster && explicit("upload"), mapping: !mappingBlocked && explicit("mapping"), access: facts.activePropertyAdministrator && explicit("access"), readiness: false,
  };
  complete.readiness = definitions.slice(0, 7).every(step => complete[step.key]);
  const steps = definitions.map(definition => ({ ...definition, complete: complete[definition.key], blocked: definition.key === "mapping" ? mappingBlocked : !complete[definition.key] && Boolean(facts.progress.steps[definition.key]?.blockingReason), warning: facts.progress.steps[definition.key]?.warning ?? null }));
  const lastIncompleteStep = steps.find(step => !step.complete)?.number ?? 8;
  const nextRecommendedAction = recommendation(steps, complete.readiness, facts);
  const minimumReady = identityComplete && rulesComplete && facts.activeDepartments > 0 && facts.activePropertyAdministrator;
  const operationalBlockingReasons = [
    !complete.positions && "职位体系尚未确认",
    !complete.upload && "员工工作簿尚未完成检查",
    !complete.mapping && "部门或职位映射尚未解决",
    !complete.access && "管理员访问安排尚未确认",
  ].filter((value): value is string => Boolean(value));
  return { steps, ready: complete.readiness, operationalReady: complete.readiness, minimumReady, operationalBlockingReasons, lastIncompleteStep, completedSteps: steps.filter(step => step.complete), progressPercent: Math.round(steps.filter(step => step.complete).length / steps.length * 100), nextRecommendedAction };
}

function recommendation(steps: readonly WizardStepState[], ready: boolean, facts: WizardFacts) {
  if (ready) return "进入系统";
  if (!steps[0].complete) return "完善酒店基本信息";
  if (!steps[1].complete) return "确认业务规则";
  if (!steps[2].complete) return facts.activeDepartments > 0 ? "确认初始组织架构" : "建立正式组织架构";
  if (!steps[3].complete) return facts.activePositions > 0 ? "确认初始职位体系" : "建立职位体系";
  if (!steps[4].complete) return facts.inspectedEmployeeMaster ? "确认工作簿检查结果" : "检查员工主数据工作簿";
  if (!steps[5].complete) return facts.unresolvedDepartmentLabels + facts.unresolvedPositionLabels > 0 ? "处理未解决的来源标签" : "确认部门与职位映射";
  if (!steps[6].complete) return facts.activePropertyAdministrator ? "确认管理员访问安排" : "配置酒店管理员";
  return "完成初始化检查";
}
