"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { EmployeeRecord } from "../../repositories/contracts/employee-repository";

type EmployeeProfileDrawerProps = {
  audience: "manager" | "department";
  employee: EmployeeRecord;
  sourceLabel: string;
  refreshedAt: string | null;
  refreshState?: "idle" | "loading" | "ready" | "error";
  refreshError?: string | null;
  returnFocus: HTMLElement | null;
  updateHistoryHref?: string;
  onRefresh?: () => void;
  onClose: () => void;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function EmployeeProfileDrawer({
  audience,
  employee,
  sourceLabel,
  refreshedAt,
  refreshState = "idle",
  refreshError,
  returnFocus,
  updateHistoryHref,
  onRefresh,
  onClose,
}: EmployeeProfileDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose, returnFocus]);

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="profile-drawer employee-profile-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="employee-profile-title"
        aria-describedby="employee-profile-boundary"
        tabIndex={-1}
      >
        <header>
          <div className="profile-avatar">{employeeInitial(employee)}</div>
          <div>
            <span>{employee.employeeNumber}</span>
            <h2 id="employee-profile-title">
              {employee.nameZh ?? "中文名待补充"} <small>{employee.nameEn}</small>
            </h2>
            <p>
              {employee.departmentName || "正式部门待确认"} ·{" "}
              {employee.positionName ?? "职位待确认"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="关闭员工档案"
          >
            关闭
          </button>
        </header>

        <section>
          <h3>员工主数据档案</h3>
          <dl>
            <div>
              <dt>员工编号</dt>
              <dd>{employee.employeeNumber}</dd>
            </div>
            <div>
              <dt>中文名 / 英文名</dt>
              <dd>
                {employee.nameZh ?? "待补充"} / {employee.nameEn ?? "待补充"}
              </dd>
            </div>
            <div>
              <dt>正式部门</dt>
              <dd>{employee.departmentName || "待确认"}</dd>
            </div>
            <div>
              <dt>运营单元</dt>
              <dd>{employee.operationalUnitName ?? "无运营单元"}</dd>
            </div>
            <div>
              <dt>职位 / 职位族</dt>
              <dd>
                {employee.positionName ?? "待确认"} /{" "}
                {employee.positionFamilyName ?? "待确认"}
              </dd>
            </div>
            <div>
              <dt>入职 / 转正确认日期</dt>
              <dd>
                {employee.hireDate ?? "待补充"} /{" "}
                {employee.probationOrConfirmationDate ?? "待补充"}
              </dd>
            </div>
            <div>
              <dt>员工状态</dt>
              <dd>
                {employmentStatus(employee.employmentStatus)}
                {employee.isNewEmployee === null
                  ? " · 新员工规则尚未接入"
                  : employee.isNewEmployee
                    ? " · 新员工"
                    : ""}
              </dd>
            </div>
          </dl>
        </section>

        <section className="profile-source-evidence" aria-live="polite">
          <h3>资料来源与核验</h3>
          <p id="employee-profile-boundary">{sourceLabel}</p>
          <dl>
            <div>
              <dt>最近读取</dt>
              <dd>{formatTimestamp(refreshedAt)}</dd>
            </div>
            <div>
              <dt>档案状态</dt>
              <dd>{refreshStatus(refreshState)}</dd>
            </div>
          </dl>
          {refreshError && <p role="alert">{refreshError}</p>}
          {audience === "manager" && onRefresh && (
            <button
              type="button"
              className="people-import-link profile-refresh"
              disabled={refreshState === "loading"}
              onClick={onRefresh}
            >
              {refreshState === "loading" ? "正在重新读取…" : "重新读取权威档案"}
            </button>
          )}
          {audience === "manager" && updateHistoryHref && (
            <Link className="people-import-link" href={updateHistoryHref}>
              查看员工资料更新记录
            </Link>
          )}
        </section>

        <section className="truthful-empty">
          <h3>培训历史尚未接入</h3>
          <p>当前档案只呈现员工主数据，不显示或推断任何培训结果。</p>
        </section>
      </aside>
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

function refreshStatus(state: NonNullable<EmployeeProfileDrawerProps["refreshState"]>) {
  const labels = {
    idle: "使用当前目录记录",
    loading: "正在重新读取",
    ready: "已完成权威重读",
    error: "重新读取失败",
  } as const;
  return labels[state];
}

function formatTimestamp(value: string | null) {
  if (!value) return "尚未完成";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "读取时间不可用";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}
