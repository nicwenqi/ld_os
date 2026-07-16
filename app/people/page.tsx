"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { EmployeeDirectory } from "../components/people/EmployeeDirectory";
import { EmployeeProfileDrawer } from "../components/people/EmployeeProfileDrawer";
import { AppShell } from "../components/shell/AppShell";
import { ProtectedAppProviders } from "../providers";
import type {
  EmployeeDirectoryOptions,
  EmployeeDirectoryPage,
  EmployeeRecord,
} from "../repositories/contracts/employee-repository";
import { createRepositoryRegistry } from "../repositories/registry";
import { createEmployeeService } from "../services/employee-service";
import { useAuthSession } from "../state/auth-session";

const PAGE_SIZE = 25;

type LoadState = "loading" | "ready" | "error";
type ManagerFilters = Pick<
  EmployeeDirectoryOptions,
  | "query"
  | "departmentId"
  | "positionId"
  | "positionFamilyId"
  | "employmentStatus"
>;
type SelectFilter = Exclude<keyof ManagerFilters, "query">;

function Page() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const employeeService = useMemo(
    () => createEmployeeService(registry.employee),
    [registry.employee],
  );
  const { session } = useAuthSession();
  const [directory, setDirectory] = useState<EmployeeDirectoryPage | null>(null);
  const [filters, setFilters] = useState<ManagerFilters>({});
  const [queryDraft, setQueryDraft] = useState("");
  const [offset, setOffset] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<EmployeeRecord | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const [profileState, setProfileState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRefreshedAt, setProfileRefreshedAt] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoadState("loading");
      setLoadError(null);
      setDirectory(null);

      const propertyId = session.propertyId;
      if (!propertyId) {
        setLoadState("error");
        setLoadError("当前账号尚未解析到有效酒店范围");
        return;
      }

      try {
        const next = await employeeService.listManagerDirectory(propertyId, {
          ...filters,
          limit: PAGE_SIZE,
          offset,
        });
        if (!active) return;
        setDirectory(next);
        setLoadState("ready");
      } catch (reason) {
        if (!active) return;
        setLoadState("error");
        setLoadError(
          reason instanceof Error ? reason.message : "员工资料读取失败",
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt, employeeService, filters, offset, session.propertyId]);

  const refreshProfile = useCallback(
    async (employeeId: string) => {
      const propertyId = session.propertyId;
      if (!propertyId) {
        setProfileState("error");
        setProfileError("当前酒店范围无法确认");
        return;
      }
      setProfileState("loading");
      setProfileError(null);
      try {
        const authoritative = await employeeService.refreshEmployee(employeeId);
        if (!authoritative || authoritative.propertyId !== propertyId) {
          throw new Error("员工档案重新读取结果不在当前酒店范围");
        }
        setSelected(authoritative);
        setProfileRefreshedAt(new Date().toISOString());
        setProfileState("ready");
      } catch (reason) {
        setProfileState("error");
        setProfileError(
          reason instanceof Error ? reason.message : "员工档案重新读取失败",
        );
      }
    },
    [employeeService, session.propertyId],
  );

  const openProfile = useCallback(
    (employee: EmployeeRecord, trigger: HTMLElement) => {
      setSelected(employee);
      setReturnFocus(trigger);
      setProfileState("idle");
      setProfileError(null);
      setProfileRefreshedAt(directory?.refreshedAt ?? null);
      void refreshProfile(employee.id);
    },
    [directory?.refreshedAt, refreshProfile],
  );

  const closeProfile = useCallback(() => {
    setSelected(null);
    setProfileError(null);
    setProfileState("idle");
  }, []);

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilters(current => ({
      ...current,
      query: queryDraft.trim() || undefined,
    }));
    setOffset(0);
  };

  const updateFilter = (name: SelectFilter, value: string) => {
    setFilters(current => ({
      ...current,
      [name]: value || undefined,
    }));
    setOffset(0);
  };

  const clearFilters = () => {
    setQueryDraft("");
    setFilters({});
    setOffset(0);
  };

  const rows = directory?.rows ?? [];
  const departmentOptions = uniqueOptions(
    rows.map(employee => ({
      id: employee.departmentId,
      label: employee.departmentName,
    })),
  );
  const positionOptions = uniqueOptions(
    rows.map(employee => ({
      id: employee.positionId,
      label: employee.positionName,
    })),
  );
  const positionFamilyOptions = uniqueOptions(
    rows.map(employee => ({
      id: employee.positionFamilyId,
      label: employee.positionFamilyName,
    })),
  );
  const sourceState =
    registry.environment.dataMode === "mock" ? ("demo" as const) : ("real" as const);
  const activeOnPage = rows.filter(
    employee => employee.employmentStatus === "active",
  ).length;
  const otherOnPage = rows.length - activeOnPage;
  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <AppShell>
      <div className="page-wrap people-page real-master-page">
        <header className="ops-header">
          <div>
            <span>员工主数据 · EMPLOYEE MASTER</span>
            <h1>员工中心</h1>
            <p>
              当前酒店的员工身份与组织档案；员工不是后台登录账号，员工记录不会创建员工登录账号、角色或工作区。
            </p>
          </div>
          <div>
            <DataStateBadge
              state={
                loadState === "error"
                  ? "failed"
                  : loadState === "ready"
                    ? sourceState
                    : "unavailable"
              }
            />
            <Link className="people-import-link" href="/import">
              员工资料更新
            </Link>
            <Link className="people-import-link" href="/import#update-history">
              更新记录
            </Link>
          </div>
        </header>

        <section className="people-insight truthful-insight">
          <div>
            <span>员工资料权威来源</span>
            <h2>
              {session.propertyNameZh ?? "当前酒店"}员工主数据
              <em> · 培训数据尚未接入，培训历史尚未接入</em>
            </h2>
            <p>
              {sourceState === "demo"
                ? "受保护评审数据，仅用于验证员工目录交互。"
                : "目录和档案均从当前登录账号所属酒店的员工主数据读取。"}
            </p>
          </div>
          <div>
            <strong>{directory ? directory.total : "—"}</strong>
            <span>当前筛选记录</span>
          </div>
          <div>
            <strong>{directory ? activeOnPage : "—"}</strong>
            <span>本页在职</span>
          </div>
          <div>
            <strong>{directory ? otherOnPage : "—"}</strong>
            <span>本页其他状态</span>
          </div>
        </section>

        <form
          className="people-tools people-filter-form"
          aria-label="当前酒店员工筛选"
          onSubmit={applySearch}
        >
          <label className="people-search">
            <input
              type="search"
              aria-label="搜索员工编号、中文名或英文名"
              placeholder="搜索员工编号、中文名或英文名"
              value={queryDraft}
              onChange={event => setQueryDraft(event.target.value)}
            />
          </label>
          <label>
            正式部门
            <select
              value={filters.departmentId ?? ""}
              onChange={event => updateFilter("departmentId", event.target.value)}
            >
              <option value="">全部部门</option>
              {departmentOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            职位
            <select
              value={filters.positionId ?? ""}
              onChange={event => updateFilter("positionId", event.target.value)}
            >
              <option value="">全部职位</option>
              {positionOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            职位族
            <select
              value={filters.positionFamilyId ?? ""}
              onChange={event =>
                updateFilter("positionFamilyId", event.target.value)
              }
            >
              <option value="">全部职位族</option>
              {positionFamilyOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            员工状态
            <select
              value={filters.employmentStatus ?? ""}
              onChange={event =>
                updateFilter("employmentStatus", event.target.value)
              }
            >
              <option value="">全部状态</option>
              <option value="active">在职</option>
              <option value="leave">休假中</option>
              <option value="inactive">非在职</option>
              <option value="terminated">已离职</option>
              <option value="unknown">待确认</option>
            </select>
          </label>
          <div className="people-filter-actions">
            <button type="submit">应用搜索</button>
            <button type="button" disabled={!hasFilters} onClick={clearFilters}>
              清除筛选
            </button>
          </div>
        </form>

        {loadState === "loading" && (
          <div className="people-empty" role="status" aria-live="polite">
            <strong>正在读取员工主数据</strong>
            <span>系统只在当前酒店范围内执行筛选与分页。</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="people-empty" role="alert">
            <strong>员工资料暂时无法读取</strong>
            <span>{loadError ?? "失败来源不会被零值或评审记录替代。"}</span>
            <button
              type="button"
              className="people-import-link"
              onClick={() => setAttempt(value => value + 1)}
            >
              重新读取
            </button>
          </div>
        )}

        {loadState === "ready" && directory && directory.rows.length > 0 && (
          <EmployeeDirectory
            audience="manager"
            rows={directory.rows}
            total={directory.total}
            offset={offset}
            pageSize={PAGE_SIZE}
            onOpenProfile={openProfile}
            onPageChange={nextOffset => setOffset(Math.max(0, nextOffset))}
          />
        )}

        {loadState === "ready" && directory && directory.rows.length === 0 && (
          <div className="people-empty">
            <strong>{hasFilters ? "没有匹配员工" : "尚无员工资料"}</strong>
            <span>
              {hasFilters
                ? "请调整当前酒店内的搜索或筛选条件。"
                : "可前往员工资料更新流程检查员工主数据。"}
            </span>
            {hasFilters ? (
              <button
                type="button"
                className="people-import-link"
                onClick={clearFilters}
              >
                清除筛选
              </button>
            ) : (
              <Link className="people-import-link" href="/import">
                前往员工资料更新
              </Link>
            )}
          </div>
        )}

        {selected && (
          <EmployeeProfileDrawer
            audience="manager"
            employee={selected}
            sourceLabel={
              sourceState === "demo"
                ? "受保护评审数据中的员工主数据档案。"
                : "当前酒店员工主数据的权威档案重读。"
            }
            refreshedAt={profileRefreshedAt}
            refreshState={profileState}
            refreshError={profileError}
            returnFocus={returnFocus}
            updateHistoryHref="/import#update-history"
            onRefresh={() => void refreshProfile(selected.id)}
            onClose={closeProfile}
          />
        )}
      </div>
    </AppShell>
  );
}

function uniqueOptions(
  values: Array<{ id: string | null; label: string | null }>,
) {
  const options = new Map<string, string>();
  for (const value of values) {
    if (value.id && value.label) options.set(value.id, value.label);
  }
  return Array.from(options, ([id, label]) => ({ id, label }));
}

export default function People() {
  return (
    <ProtectedAppProviders>
      <Page />
    </ProtectedAppProviders>
  );
}
