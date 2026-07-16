"use client";

import type { EmployeeRecord } from "../../repositories/contracts/employee-repository";

type DirectoryAudience = "manager" | "department";

type EmployeeDirectoryProps = {
  audience: DirectoryAudience;
  rows: readonly EmployeeRecord[];
  total: number;
  offset: number;
  pageSize: number;
  onOpenProfile: (employee: EmployeeRecord, trigger: HTMLElement) => void;
  onPageChange: (offset: number) => void;
};

export function EmployeeDirectory({
  audience,
  rows,
  total,
  offset,
  pageSize,
  onOpenProfile,
  onPageChange,
}: EmployeeDirectoryProps) {
  const firstVisible = total === 0 ? 0 : offset + 1;
  const lastVisible = Math.min(offset + rows.length, total);
  const hasPrevious = offset > 0;
  const hasNext = offset + pageSize < total;

  return (
    <div className={`employee-directory employee-directory-${audience}`}>
      {audience === "manager" ? (
        <>
          <div className="people-table-head" aria-hidden="true">
            <span />
            <span>员工身份</span>
            <span>部门与职位</span>
            <span>入职资料</span>
            <span>来源状态</span>
            <span>档案</span>
          </div>
          <section className="people-list" aria-label="当前酒店员工主数据列表">
            {rows.map(employee => (
              <article key={employee.id}>
                <span aria-hidden="true" />
                <button
                  type="button"
                  className="identity-cell"
                  onClick={event => onOpenProfile(employee, event.currentTarget)}
                >
                  <span>{employeeInitial(employee)}</span>
                  <div>
                    <strong>
                      {employee.nameZh ?? "中文名待补充"}{" "}
                      <small>{employee.nameEn}</small>
                    </strong>
                    <em>
                      {employee.employeeNumber}
                      {employee.isNewEmployee && <b>新员工</b>}
                    </em>
                  </div>
                </button>
                <div className="dept-cell">
                  <strong>{employee.departmentName || "正式部门待确认"}</strong>
                  <small>
                    {employee.operationalUnitName
                      ? `${employee.operationalUnitName} · `
                      : ""}
                    {employee.positionName ?? "职位待确认"} ·{" "}
                    {employee.positionFamilyName ?? "职位族待确认"}
                  </small>
                </div>
                <div className="training-cell">
                  <strong>{formatDate(employee.hireDate)}</strong>
                  <small>
                    {employmentStatus(employee.employmentStatus)}
                    {employee.probationOrConfirmationDate
                      ? ` · 转正确认 ${formatDate(employee.probationOrConfirmationDate)}`
                      : ""}
                  </small>
                </div>
                <div className="risk-tags employee-record-state">
                  <span className="not-connected">权威员工主数据</span>
                  <small>{employee.isNewEmployee ? "新员工标记已确认" : "当前员工记录"}</small>
                </div>
                <button
                  type="button"
                  className="next-cell"
                  onClick={event => onOpenProfile(employee, event.currentTarget)}
                >
                  查看员工档案
                </button>
              </article>
            ))}
          </section>
        </>
      ) : (
        <div className="scoped-employee-list">
          <div className="scoped-employee-table-head" aria-hidden="true">
            <span>员工</span>
            <span>部门归属</span>
            <span>职位</span>
            <span>员工状态</span>
            <span>档案</span>
          </div>
          {rows.map(employee => (
            <article key={employee.id}>
              <div>
                <button
                  type="button"
                  className="employee-identity-cell employee-profile-trigger"
                  onClick={event => onOpenProfile(employee, event.currentTarget)}
                >
                  <span aria-hidden="true">{employeeInitial(employee)}</span>
                  <span>
                    <strong>{employee.nameZh ?? employee.nameEn ?? "姓名未提供"}</strong>
                    <small>
                      {employee.employeeNumber}
                      {employee.nameZh && employee.nameEn ? ` · ${employee.nameEn}` : ""}
                    </small>
                  </span>
                </button>
              </div>
              <div>
                <strong>{employee.departmentName || "部门名称未提供"}</strong>
                <small>{employee.operationalUnitName ?? "无运营单元"}</small>
              </div>
              <div>
                <strong>{employee.positionName ?? "职位待确认"}</strong>
                <small>{employee.positionFamilyName ?? "职位族待确认"}</small>
              </div>
              <div>
                <strong>{employmentStatus(employee.employmentStatus)}</strong>
                <small>
                  {formatDate(employee.hireDate)}
                  {employee.isNewEmployee ? " · 新员工" : ""}
                </small>
              </div>
              <div>
                <button
                  type="button"
                  className="next-cell employee-profile-trigger"
                  onClick={event => onOpenProfile(employee, event.currentTarget)}
                >
                  查看档案
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <nav className="employee-directory-pagination" aria-label="员工列表分页">
        <span>
          第 {firstVisible}–{lastVisible} 条，共 {total} 条
        </span>
        <div>
          <button
            type="button"
            disabled={!hasPrevious}
            onClick={() => onPageChange(offset - pageSize)}
          >
            上一页
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => onPageChange(offset + pageSize)}
          >
            下一页
          </button>
        </div>
      </nav>
    </div>
  );
}

function employeeInitial(employee: EmployeeRecord) {
  return (employee.nameZh ?? employee.nameEn ?? "员").slice(0, 1);
}

function employmentStatus(status: EmployeeRecord["employmentStatus"]) {
  const labels: Record<EmployeeRecord["employmentStatus"], string> = {
    active: "在职",
    inactive: "非在职",
    leave: "休假中",
    terminated: "已离职",
    unknown: "待确认",
  };
  return labels[status];
}

function formatDate(value: string | null) {
  return value ?? "日期待补充";
}
