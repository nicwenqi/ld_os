export type C2ActivationFacts = {
  initializationState: "not_started" | "in_progress" | "ready";
  activeDepartments: number;
  activePropertyManagers: number;
  activeDepartmentAdministrators: number;
  activeDepartmentAdministratorsWithScope: number;
};

export function resolveC2InitializationState(input: {
  progressState?: C2ActivationFacts["initializationState"];
  completedAt?: string | null;
  propertySettingsState: C2ActivationFacts["initializationState"];
}): C2ActivationFacts["initializationState"] {
  return input.progressState
    ?? (input.completedAt ? "ready" : input.propertySettingsState);
}

export type C2ReadinessCheck = {
  label: string;
  detail: string;
  state: "ready" | "pending";
  optional?: boolean;
};

export function deriveC2EmployeeBaselineReadiness(facts: C2ActivationFacts) {
  const scopesResolved = facts.activeDepartmentAdministrators === 0
    || facts.activeDepartmentAdministratorsWithScope === facts.activeDepartmentAdministrators;
  const checks: C2ReadinessCheck[] = [
    {
      label: "酒店启用复核",
      detail: facts.initializationState === "ready"
        ? "酒店身份、业务规则、正式部门与活动经理已完成有限启用复核。"
        : "请先完成有限启用复核。",
      state: facts.initializationState === "ready" ? "ready" : "pending",
    },
    {
      label: "活动酒店学习与发展经理",
      detail: facts.activePropertyManagers > 0
        ? `${facts.activePropertyManagers} 位活动经理可维护员工资料基础。`
        : "至少需要一位活动酒店学习与发展经理。",
      state: facts.activePropertyManagers > 0 ? "ready" : "pending",
    },
    {
      label: "正式组织结构",
      detail: facts.activeDepartments > 0
        ? `${facts.activeDepartments} 个有效正式部门已由酒店管理员维护。`
        : "至少需要一个有效正式部门。",
      state: facts.activeDepartments > 0 ? "ready" : "pending",
    },
    {
      label: "部门培训负责人范围",
      detail: facts.activeDepartmentAdministrators === 0
        ? "尚未委派部门培训负责人；这不阻塞员工基线。"
        : scopesResolved
          ? `${facts.activeDepartmentAdministratorsWithScope} 位部门培训负责人均有明确正式部门范围。`
          : "存在未能解析明确部门范围的部门培训负责人。",
      state: scopesResolved ? "ready" : "pending",
      optional: facts.activeDepartmentAdministrators === 0,
    },
  ];
  const ready = checks.every((check) => check.state === "ready");
  const nextAction = facts.initializationState !== "ready"
    ? "完成酒店启用复核"
    : facts.activePropertyManagers === 0
      ? "恢复或指定活动酒店学习与发展经理"
      : facts.activeDepartments === 0
        ? "建立至少一个有效正式部门"
        : !scopesResolved
          ? "在账号与角色中修复部门培训负责人部门范围"
          : "前往员工资料更新，开始零写员工基线预览";
  return {
    ready,
    label: ready ? "Property Ready for Employee Baseline" : "Property Activation Needs Attention",
    checks,
    nextAction,
  };
}
