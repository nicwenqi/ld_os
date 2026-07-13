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
    identity: identityComplete, rules: rulesComplete, organization: facts.activeDepartments > 0, positions: facts.activePositions > 0 && explicit("positions"),
    upload: facts.inspectedEmployeeMaster && explicit("upload"), mapping: !mappingBlocked && explicit("mapping"), access: facts.activePropertyAdministrator && explicit("access"), readiness: false,
  };
  complete.readiness = definitions.slice(0, 7).every(step => complete[step.key]);
  const steps = definitions.map(definition => ({ ...definition, complete: complete[definition.key], blocked: definition.key === "mapping" ? mappingBlocked : !complete[definition.key] && Boolean(facts.progress.steps[definition.key]?.blockingReason), warning: facts.progress.steps[definition.key]?.warning ?? null }));
  const lastIncompleteStep = steps.find(step => !step.complete)?.number ?? 8;
  return { steps, ready: complete.readiness, lastIncompleteStep, completedSteps: steps.filter(step => step.complete), progressPercent: Math.round(steps.filter(step => step.complete).length / steps.length * 100) };
}
