"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataStateBadge } from "../operations/DataStateBadge";
import { AppShell } from "../shell/AppShell";
import type {
  DepartmentRequirementFoundation,
  RequirementVersion,
} from "../../repositories/contracts/learning-requirement-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import { EligibilityPreview } from "./EligibilityPreview";

export function DepartmentRequirementWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const [foundation, setFoundation] =
    useState<DepartmentRequirementFoundation | null>(null);
  const [selected, setSelected] = useState<RequirementVersion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void registry.learningRequirement.readDepartmentRequirements()
      .then(next => {
        if (!active) return;
        setFoundation(next);
        setSelected(next.requirements[0] ?? null);
      })
      .catch(reason => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "部门培训要求暂时无法读取。",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [registry]);

  return (
    <AppShell>
      <div className="page-wrap requirement-workspace department-requirement-workspace">
        <nav className="page-breadcrumb" aria-label="页面路径">
          <Link href="/department">部门工作台</Link>
          <span aria-hidden="true">/</span>
          <strong>培训要求</strong>
        </nav>

        <header className="requirement-hero department-requirement-hero">
          <div>
            <span>AUTHORIZED LEARNING REQUIREMENTS</span>
            <h1>本部门培训要求</h1>
            <p>
              只读查看服务器根据当前账号授权范围返回的已生效酒店培训义务。
            </p>
          </div>
          <aside>
            <DataStateBadge
              state={
                error
                  ? "failed"
                  : foundation?.source === "local_review"
                    ? "demo"
                    : "real"
              }
            />
            <strong>{foundation?.requirements.length ?? "—"}</strong>
            <span>项可见已生效要求</span>
          </aside>
        </header>

        <section className="department-requirement-scope">
          <header>
            <div>
              <span>SERVER-AUTHORIZED SCOPE</span>
              <h2>授权部门范围</h2>
            </div>
            <strong>只读</strong>
          </header>
          {!foundation && !error && <p role="status">正在读取服务器授权范围…</p>}
          {error && (
            <div className="requirement-error" role="alert">
              <strong>授权范围或培训要求读取失败</strong>
              <span>{error}</span>
            </div>
          )}
          <div className="department-requirement-scope-list">
            {foundation?.scope.map(scope => (
              <article key={scope.departmentId}>
                <span>当前授权分支</span>
                <strong>{scope.departmentName}</strong>
                <small>
                  {scope.includeDescendants
                    ? "包含服务器确认的下级部门"
                    : "仅限此部门本级"}
                </small>
              </article>
            ))}
          </div>
        </section>

        <section className="department-effective-requirements">
          <header>
            <div>
              <span>EFFECTIVE OBLIGATIONS</span>
              <h2>仅显示已生效要求</h2>
              <p>不会显示草稿或仅已批准版本，也不能在此修改酒店义务。</p>
            </div>
          </header>

          {foundation && foundation.requirements.length === 0 && (
            <div className="requirement-empty">
              <strong>当前授权范围尚无可显示的已生效培训要求</strong>
              <span>
                这不代表员工没有培训义务；可能是要求尚未生效、范围不适用或数据仍待经理确认。
              </span>
            </div>
          )}

          <div className="department-requirement-list">
            {foundation?.requirements.map(requirement => (
              <button
                type="button"
                className={selected?.id === requirement.id ? "selected" : ""}
                key={requirement.id}
                onClick={() => setSelected(requirement)}
              >
                <span>{requirement.code}</span>
                <strong>{requirement.nameZh}</strong>
                <small>{requirement.obligationExplanation}</small>
                <em>V{requirement.versionNumber} · 已生效</em>
              </button>
            ))}
          </div>
        </section>

        {foundation && selected && (
          <>
            <p className="department-evaluation-intro">
              以下适用性评估按所选日期和员工事实版本只读计算。
            </p>
            <EligibilityPreview
              propertyId={foundation.propertyId}
              requirement={selected}
              repository={registry.learningRequirement}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
