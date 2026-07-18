export type EmployeeUpdateStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const EMPLOYEE_UPDATE_STEPS: ReadonlyArray<{
  step: EmployeeUpdateStep;
  label: string;
  shortLabel: string;
}> = [
  { step: 1, label: "文件检查", shortLabel: "检查" },
  { step: 2, label: "字段识别", shortLabel: "字段" },
  { step: 3, label: "部门归属确认", shortLabel: "部门" },
  { step: 4, label: "职位归属确认", shortLabel: "职位" },
  { step: 5, label: "数据问题处理", shortLabel: "问题" },
  { step: 6, label: "更新预览", shortLabel: "预览" },
  { step: 7, label: "确认更新", shortLabel: "确认" },
];

export function EmployeeUpdateProgress({
  activeStep,
  availableStep,
  onSelect,
}: {
  activeStep: EmployeeUpdateStep;
  availableStep: EmployeeUpdateStep;
  onSelect: (step: EmployeeUpdateStep) => void;
}) {
  return (
    <nav className="employee-update-progress" aria-label="员工资料更新步骤">
      <ol>
        {EMPLOYEE_UPDATE_STEPS.map(item => {
          const current = item.step === activeStep;
          const available = item.step <= availableStep;
          const completed = item.step < availableStep;
          return (
            <li key={item.step} className={current ? "current" : completed ? "completed" : "pending"}>
              <button
                type="button"
                disabled={!available}
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(item.step)}
              >
                <span>{String(item.step).padStart(2, "0")}</span>
                <strong>{item.label}</strong>
                <small>{item.shortLabel}</small>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
