"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataStateBadge } from "../operations/DataStateBadge";
import { AppShell } from "../shell/AppShell";
import type { DepartmentNode, OfficialPosition, PositionFamily } from "../../repositories/contracts/organization-models.ts";
import type {
  CourseVersion,
  LearningRequirementFoundation,
  RequirementVersion,
} from "../../repositories/contracts/learning-requirement-repository.ts";
import { createRepositoryRegistry } from "../../repositories/registry.ts";
import { useAuthSession } from "../../state/auth-session";
import { CourseVersionEditor } from "./CourseVersionEditor";
import { EligibilityPreview } from "./EligibilityPreview";
import { RequirementVersionEditor } from "./RequirementVersionEditor";

type Editor =
  | {
      type: "requirement";
      value: RequirementVersion | null;
      newVersionOf?: RequirementVersion;
    }
  | {
      type: "course";
      value: CourseVersion | null;
      newVersionOf?: CourseVersion;
    }
  | null;

export function RequirementWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [foundation, setFoundation] =
    useState<LearningRequirementFoundation | null>(null);
  const [departments, setDepartments] = useState<DepartmentNode[]>([]);
  const [positions, setPositions] = useState<OfficialPosition[]>([]);
  const [positionFamilies, setPositionFamilies] = useState<PositionFamily[]>([]);
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [activeView, setActiveView] =
    useState<"requirements" | "courses">("requirements");
  const [editor, setEditor] = useState<Editor>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const resolvePropertyId = useCallback(async () => {
    if (registry.environment.dataMode !== "mock") return session.propertyId;
    return (await registry.property.resolveContext(
      "training-demo.example.test",
    ))?.propertyId ?? null;
  }, [registry, session.propertyId]);

  const reload = useCallback(async () => {
    const propertyId = await resolvePropertyId();
    if (!propertyId) throw new Error("当前账号尚未取得酒店培训要求上下文。");
    const [next, nextDepartments, nextPositions, nextFamilies] =
      await Promise.all([
        registry.learningRequirement.readManagerFoundation(propertyId),
        registry.department.listTree(propertyId),
        registry.position.listPositions(propertyId),
        registry.position.listPositionFamilies(propertyId),
      ]);
    setFoundation(next);
    setDepartments(nextDepartments);
    setPositions(nextPositions);
    setPositionFamilies(nextFamilies);
    setSelectedRequirementId(current =>
      next.requirements.some(item => item.id === current)
        ? current
        : next.requirements[0]?.id ?? ""
    );
    return next;
  }, [registry, resolvePropertyId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      void reload()
        .catch(reason => {
          if (active) {
            setError(
              reason instanceof Error
                ? reason.message
                : "培训要求基础暂时无法读取。",
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [reload]);

  const selectedRequirement = foundation?.requirements.find(
    item => item.id === selectedRequirementId,
  ) ?? null;
  const latestRequirements = latestRequirementVersions(
    foundation?.requirements ?? [],
  );
  const latestCourses = latestCourseVersions(foundation?.courses ?? []);

  const handleSaved = async (
    value: CourseVersion | RequirementVersion,
  ) => {
    const next = await reload();
    if ("requirementId" in value) {
      setSelectedRequirementId(value.id);
      setEditor({
        type: "requirement",
        value: next.requirements.find(item => item.id === value.id) ?? value,
      });
    } else {
      setEditor({
        type: "course",
        value: next.courses.find(item => item.id === value.id) ?? value,
      });
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="page-wrap requirement-loading" role="status">
          正在读取酒店培训要求基础…
        </div>
      </AppShell>
    );
  }

  if (!foundation || error) {
    return (
      <AppShell>
        <div className="page-wrap requirement-workspace">
          <section className="requirement-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>培训要求基础暂时无法读取</h1>
            <p>{error ?? "读取失败不会被解释为酒店没有培训义务。"}</p>
            <button type="button" onClick={() => void reload()}>
              重新读取
            </button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  const dataState = foundation.source === "local_review" ? "demo" : "real";

  return (
    <AppShell>
      <div className="page-wrap requirement-workspace">
        <nav className="page-breadcrumb" aria-label="页面路径">
          <Link href="/">运营工作台</Link>
          <span aria-hidden="true">/</span>
          <span>周期复盘</span>
          <span aria-hidden="true">/</span>
          <strong>培训要求</strong>
        </nav>

        <header className="requirement-hero">
          <div>
            <span>LEARNING REQUIREMENT FOUNDATION</span>
            <h1>酒店培训要求</h1>
            <p>
              先管理酒店培训义务，再定义可接受的学习方式与适用人群。这里不创建培训任务或执行事实。
            </p>
          </div>
          <aside>
            <DataStateBadge state={dataState} />
            <strong>{latestRequirements.length}</strong>
            <span>个培训义务主体</span>
            {foundation.source === "local_review" && (
              <small>受保护评审数据，仅限本地环境</small>
            )}
          </aside>
        </header>

        <section className="requirement-judgment">
          <div>
            <span>当前基础判断</span>
            <h2>
              {latestRequirements.length > 0
                ? "酒店义务基础已建立，可继续审核版本和适用证据"
                : "尚未建立正式培训要求"}
            </h2>
            <p>
              {latestRequirements.length > 0
                ? "只有已批准并按生效日期激活的版本才会向部门角色显示。"
                : "建议由经理以“消防安全年度培训”作为首个 Pilot 案例，明确填写 Requirement Version；系统不会自动生成课程、要求、员工任务或执行事实。课程版本仅在选择内部课程方式时才需要。"}
            </p>
          </div>
          <div className="requirement-boundary-note">
            <strong>事实边界</strong>
            <span>适用不等于已分配，已发布课程不等于已完成。</span>
          </div>
        </section>

        <nav className="requirement-tabs" aria-label="培训要求基础视图">
          <button
            type="button"
            className={activeView === "requirements" ? "active" : ""}
            onClick={() => setActiveView("requirements")}
          >
            酒店培训义务
          </button>
          <button
            type="button"
            className={activeView === "courses" ? "active" : ""}
            onClick={() => setActiveView("courses")}
          >
            课程与学习方式
          </button>
        </nav>

        {activeView === "requirements" && (
          <section className="requirement-register">
            <header>
              <div>
                <span>OBLIGATION REGISTER</span>
                <h2>培训要求版本</h2>
                <p>Requirement 是酒店业务义务；课程版本只是认可学习方式之一。</p>
              </div>
              <button
                type="button"
                className="primary-action"
                onClick={() =>
                  setEditor({ type: "requirement", value: null })}
              >
                建立培训要求
              </button>
            </header>

            {latestRequirements.length === 0 && (
              <div className="requirement-empty">
                <strong>尚未建立培训要求</strong>
                <span>
                  系统不会从课程、集团提示或 CTC/GTC 字段自动生成酒店义务。
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditor({ type: "requirement", value: null })}
                >
                  建立第一项酒店培训义务
                </button>
              </div>
            )}

            <div className="requirement-card-grid">
              {latestRequirements.map(requirement => (
                <article
                  className={
                    selectedRequirementId === requirement.id
                      ? "selected"
                      : ""
                  }
                  key={requirement.id}
                >
                  <button
                    type="button"
                    className="requirement-card-main"
                    onClick={() => setSelectedRequirementId(requirement.id)}
                  >
                    <span>{requirement.code}</span>
                    <h3>{requirement.nameZh}</h3>
                    <p>{requirement.obligationExplanation}</p>
                    <footer>
                      <VersionState state={requirement.state} />
                      <small>V{requirement.versionNumber}</small>
                    </footer>
                  </button>
                  <button
                    type="button"
                    className="card-action"
                    onClick={() =>
                      setEditor({ type: "requirement", value: requirement })}
                  >
                    查看与维护
                  </button>
                  {requirement.state !== "draft" && (
                    <button
                      type="button"
                      className="card-action"
                      onClick={() =>
                        setEditor({
                          type: "requirement",
                          value: null,
                          newVersionOf: requirement,
                        })}
                    >
                      建立新版本
                    </button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {activeView === "courses" && (
          <section className="requirement-register">
            <header>
              <div>
                <span>LEARNING METHOD CATALOGUE</span>
                <h2>课程版本基础</h2>
                <p>分开保存内容身份、能力身份与版本连续性。</p>
              </div>
              <button
                type="button"
                className="primary-action"
                onClick={() => setEditor({ type: "course", value: null })}
              >
                建立课程版本
              </button>
            </header>
            {latestCourses.length === 0 && (
              <div className="requirement-empty">
                <strong>尚未建立课程版本</strong>
                <span>
                  如培训要求采用外部证书或受控评估，可不先建立课程。
                </span>
              </div>
            )}
            <div className="course-card-grid">
              {latestCourses.map(course => (
                <article key={course.id}>
                  <span>{course.code}</span>
                  <h3>{course.nameZh}</h3>
                  <p>{course.description}</p>
                  <footer>
                    <VersionState state={course.state} />
                    <button
                      type="button"
                      onClick={() =>
                        setEditor({ type: "course", value: course })}
                    >
                      查看与维护
                    </button>
                    {["published", "retired"].includes(course.state) && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditor({
                            type: "course",
                            value: null,
                            newVersionOf: course,
                          })}
                      >
                        建立新版本
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )}

        {selectedRequirement && (
          <EligibilityPreview
            propertyId={foundation.propertyId}
            requirement={selectedRequirement}
            repository={registry.learningRequirement}
          />
        )}

        {editor && (
          <div className="requirement-editor-layer" role="dialog" aria-modal="true">
            <div className="requirement-editor-shell">
              {editor.type === "course" ? (
                <CourseVersionEditor
                  key={editor.value?.id ?? "new-course"}
                  propertyId={foundation.propertyId}
                  repository={registry.learningRequirement}
                  initial={editor.value}
                  newVersionOf={editor.newVersionOf}
                  onSaved={handleSaved}
                  onClose={() => setEditor(null)}
                />
              ) : (
                <RequirementVersionEditor
                  key={editor.value?.id ?? "new-requirement"}
                  propertyId={foundation.propertyId}
                  repository={registry.learningRequirement}
                  initial={editor.value}
                  newVersionOf={editor.newVersionOf}
                  courses={foundation.courses}
                  departments={departments}
                  positions={positions}
                  positionFamilies={positionFamilies}
                  onSaved={handleSaved}
                  onClose={() => setEditor(null)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function VersionState({ state }: { state: string }) {
  return (
    <span className={`version-state ${state}`}>
      {{
        draft: "草稿",
        review: "复核中",
        published: "已发布",
        approved: "已批准",
        effective: "已生效",
        superseded: "已被替代",
        retired: "已停用",
      }[state] ?? state}
    </span>
  );
}

function latestCourseVersions(versions: CourseVersion[]) {
  const latest = new Map<string, CourseVersion>();
  for (const version of versions) {
    const existing = latest.get(version.courseId);
    if (!existing || version.versionNumber > existing.versionNumber) {
      latest.set(version.courseId, version);
    }
  }
  return [...latest.values()];
}

function latestRequirementVersions(versions: RequirementVersion[]) {
  const latest = new Map<string, RequirementVersion>();
  for (const version of versions) {
    const existing = latest.get(version.requirementId);
    if (!existing || version.versionNumber > existing.versionNumber) {
      latest.set(version.requirementId, version);
    }
  }
  return [...latest.values()];
}
