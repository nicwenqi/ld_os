"use client";

import { useMemo, useState } from "react";
import {
  AdministrationSaveState,
  savedTime,
  type AdministrationSavePhase,
  useUnsavedChangesWarning,
} from "../administration/AdministrationSaveState";
import type { DepartmentNode, OfficialPosition, PositionFamily } from "../../repositories/contracts/organization-models.ts";
import type {
  AcceptedLearningMethodDraft,
  CourseVersion,
  EligibilityRuleSetDraft,
  LearningRequirementRepository,
  RequirementTimingDefinition,
  RequirementVersion,
  RequirementVersionDraft,
  RequirementVersionState,
} from "../../repositories/contracts/learning-requirement-repository.ts";
import { validateRequirementDraft } from "../../services/learning-requirement-service.ts";

export function RequirementVersionEditor({
  propertyId,
  repository,
  initial,
  newVersionOf,
  courses,
  departments,
  positions,
  positionFamilies,
  onSaved,
  onClose,
}: {
  propertyId: string;
  repository: LearningRequirementRepository;
  initial?: RequirementVersion | null;
  newVersionOf?: RequirementVersion | null;
  courses: CourseVersion[];
  departments: DepartmentNode[];
  positions: OfficialPosition[];
  positionFamilies: PositionFamily[];
  onSaved: (value: RequirementVersion) => Promise<void> | void;
  onClose: () => void;
}) {
  const baseline = useMemo(
    () =>
      initial
        ? requirementDraftFrom(initial)
        : newVersionOf
          ? nextRequirementDraftFrom(newVersionOf)
          : emptyRequirementDraft(propertyId),
    [initial, newVersionOf, propertyId],
  );
  const [draft, setDraft] = useState<RequirementVersionDraft>(baseline);
  const [phase, setPhase] =
    useState<AdministrationSavePhase>("pristine");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const immutable = Boolean(initial && initial.state !== "draft");
  const dirty = phase === "dirty";
  useUnsavedChangesWarning(dirty, "培训要求版本有未保存更改");

  const update = <K extends keyof RequirementVersionDraft>(
    key: K,
    value: RequirementVersionDraft[K],
  ) => {
    setDraft(current => ({ ...current, [key]: value }));
    setPhase("dirty");
    setStatus("培训要求版本尚未保存");
  };
  const updateCompletionMethods = (
    methods: AcceptedLearningMethodDraft[],
  ) => update("completionDefinition", {
    satisfactionOperator: "any_one",
    methods,
  });
  const updateRule = (
    index: number,
    patch: Partial<EligibilityRuleSetDraft>,
  ) => update(
    "ruleSets",
    draft.ruleSets.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ...patch } : rule
    ),
  );

  const saveRequirementVersionDraft = async () => {
    const errors = validateRequirementDraft(draft);
    if (errors.length > 0) {
      setPhase("failed");
      setStatus(errors.join(" "));
      return;
    }
    try {
      setPhase("saving");
      setStatus("正在保存培训要求并重新读取服务器状态");
      const saved = await repository.saveRequirementVersionDraft(draft);
      setDraft(requirementDraftFrom(saved));
      setPhase("saved");
      setSavedAt(savedTime());
      setStatus("培训要求草稿已保存并重新读取服务器状态");
      await onSaved(saved);
    } catch (error) {
      setPhase(isConflict(error) ? "conflict" : "failed");
      setStatus(message(error));
    }
  };

  const transitionRequirementVersion = async (
    target: RequirementVersionState,
  ) => {
    if (!initial) return;
    const reason = target === "retired"
      ? window.prompt("请说明停用此培训要求版本的原因")
      : null;
    if (target === "retired" && !reason?.trim()) {
      setPhase("failed");
      setStatus("停用培训要求版本必须说明原因。");
      return;
    }
    try {
      setPhase("saving");
      setStatus("正在更新版本状态并重新读取服务器状态");
      const saved = await repository.transitionRequirementVersion(
        initial.id,
        target,
        initial.expectedVersion,
        reason ?? undefined,
      );
      setDraft(requirementDraftFrom(saved));
      setPhase("saved");
      setSavedAt(savedTime());
      setStatus("培训要求版本状态已更新并重新读取服务器状态");
      await onSaved(saved);
    } catch (error) {
      setPhase(isConflict(error) ? "conflict" : "failed");
      setStatus(message(error));
    }
  };

  return (
    <section
      className="requirement-editor requirement-version-editor"
      aria-labelledby="requirement-editor-title"
    >
      <header>
        <div>
          <span>HOTEL BUSINESS OBLIGATION</span>
          <h2 id="requirement-editor-title">
            {initial
              ? `${initial.nameZh} · V${initial.versionNumber}`
              : newVersionOf
                ? `${newVersionOf.nameZh} · 建立 V${newVersionOf.versionNumber + 1}`
              : "建立培训要求版本"}
          </h2>
          <p>定义酒店要求什么、谁适用、何时适用，以及未来哪些方式可满足。</p>
        </div>
        <button type="button" className="quiet-button" onClick={onClose}>
          关闭
        </button>
      </header>

      <AdministrationSaveState
        phase={phase}
        savedAt={savedAt}
        message={status}
        onRetry={() => void saveRequirementVersionDraft()}
        onReload={onClose}
      />

      {immutable && (
        <div className="immutable-notice">
          <strong>已批准或已生效版本不可编辑</strong>
          <span>义务定义、完成方式和适用范围如需调整，必须建立新版本。</span>
        </div>
      )}

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>酒店培训义务</legend>
        <div className="requirement-form-grid">
          <label>
            <span>要求代码</span>
            <input
              value={draft.code}
              onChange={event =>
                update("code", normalizedCode(event.target.value))}
              placeholder="FIRE-ANNUAL"
            />
          </label>
          <label>
            <span>中文名称</span>
            <input
              value={draft.nameZh}
              onChange={event => update("nameZh", event.target.value)}
            />
          </label>
          <label>
            <span>英文名称</span>
            <input
              value={draft.nameEn ?? ""}
              onChange={event => update("nameEn", event.target.value)}
            />
          </label>
          <label>
            <span>生效日期</span>
            <input
              type="date"
              value={draft.effectiveFrom}
              onChange={event => {
                update("effectiveFrom", event.target.value);
                updateRule(0, { effectiveFrom: event.target.value });
              }}
            />
          </label>
          <label>
            <span>结束日期（可选）</span>
            <input
              type="date"
              value={draft.effectiveTo ?? ""}
              onChange={event => {
                update("effectiveTo", event.target.value || undefined);
                updateRule(0, {
                  effectiveTo: event.target.value || undefined,
                });
              }}
            />
          </label>
        </div>
        <label>
          <span>要求目的</span>
          <textarea
            value={draft.purpose}
            onChange={event => update("purpose", event.target.value)}
          />
        </label>
        <label>
          <span>酒店业务义务说明</span>
          <textarea
            value={draft.obligationExplanation}
            onChange={event =>
              update("obligationExplanation", event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>期限定义</legend>
        <div className="requirement-form-grid">
          <label>
            <span>期限类型</span>
            <select
              value={draft.timing.type}
              onChange={event =>
                update(
                  "timing",
                  timingFor(event.target.value) as RequirementTimingDefinition,
                )}
            >
              <option value="fixed_date">一次性固定日期</option>
              <option value="hire_relative">入职后期限</option>
              <option value="calendar_recurrence">自然周期</option>
              <option value="interval_months">固定月数间隔</option>
            </select>
          </label>
          {draft.timing.type === "fixed_date" && (
            <label>
              <span>到期日</span>
              <input
                type="date"
                value={draft.timing.dueDate}
                onChange={event =>
                  update("timing", {
                    type: "fixed_date",
                    dueDate: event.target.value,
                  })}
              />
            </label>
          )}
          {draft.timing.type === "hire_relative" && (
            <label>
              <span>入职后天数</span>
              <input
                type="number"
                min="1"
                value={draft.timing.dueWithinDays}
                onChange={event =>
                  update("timing", {
                    type: "hire_relative",
                    dueWithinDays: Number(event.target.value),
                  })}
              />
            </label>
          )}
          {draft.timing.type === "calendar_recurrence" && (
            <label>
              <span>自然周期</span>
              <select
                value={draft.timing.period}
                onChange={event =>
                  update("timing", {
                    type: "calendar_recurrence",
                    period: event.target.value as "month" | "quarter" | "year",
                  })}
              >
                <option value="month">每月</option>
                <option value="quarter">每季度</option>
                <option value="year">每年</option>
              </select>
            </label>
          )}
          {draft.timing.type === "interval_months" && (
            <>
              <label>
                <span>间隔月数</span>
                <input
                  type="number"
                  min="1"
                  value={draft.timing.intervalMonths}
                  onChange={event =>
                    update("timing", {
                      type: "interval_months",
                      intervalMonths: Number(event.target.value),
                      anchorDate: draft.timing.type === "interval_months"
                        ? draft.timing.anchorDate
                        : new Date().toISOString().slice(0, 10),
                    })}
                />
              </label>
              <label>
                <span>锚点日期</span>
                <input
                  type="date"
                  value={draft.timing.anchorDate}
                  onChange={event =>
                    update("timing", {
                      type: "interval_months",
                      intervalMonths: draft.timing.type === "interval_months"
                        ? draft.timing.intervalMonths
                        : 12,
                      anchorDate: event.target.value,
                    })}
                />
              </label>
            </>
          )}
        </div>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>完成定义 · 认可学习方式</legend>
        <p className="field-guidance">
          任一认可方式在未来经可信事实证明后才可能满足要求；D1 不创建完成记录。
        </p>
        <div className="method-add-row">
          <button
            type="button"
            onClick={() =>
              updateCompletionMethods([
                ...draft.completionDefinition.methods,
                blankMethod("course_version"),
              ])}
          >
            + 已发布课程版本
          </button>
          <button
            type="button"
            onClick={() =>
              updateCompletionMethods([
                ...draft.completionDefinition.methods,
                blankMethod("external_certificate"),
              ])}
          >
            + 外部证书
          </button>
          <button
            type="button"
            onClick={() =>
              updateCompletionMethods([
                ...draft.completionDefinition.methods,
                blankMethod("assessment"),
              ])}
          >
            + 受控评估
          </button>
          <button
            type="button"
            onClick={() =>
              updateCompletionMethods([
                ...draft.completionDefinition.methods,
                blankMethod("manager_equivalency"),
              ])}
          >
            + 经理等价认定定义
          </button>
        </div>
        <div className="learning-method-list">
          {draft.completionDefinition.methods.map((method, index) => (
            <LearningMethodEditor
              key={method.id ?? `${method.type}-${index}`}
              method={method}
              publishedCourses={courses.filter(
                course => course.state === "published",
              )}
              onChange={next =>
                updateCompletionMethods(
                  draft.completionDefinition.methods.map((item, itemIndex) =>
                    itemIndex === index ? next : item
                  ),
                )}
              onRemove={() =>
                updateCompletionMethods(
                  draft.completionDefinition.methods.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                )}
            />
          ))}
          {draft.completionDefinition.methods.length === 0 && (
            <div className="inline-empty">
              尚未添加认可完成方式，草稿不能批准。
            </div>
          )}
        </div>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>适用规则</legend>
        <p className="field-guidance">
          同一要求版本的规则期间不得重叠；每个维度内“任一匹配”，维度之间“全部满足”。
        </p>
        {draft.ruleSets.map((rule, index) => (
          <article className="eligibility-rule-card" key={rule.id ?? index}>
            <header>
              <strong>规则期间 {index + 1}</strong>
              {draft.ruleSets.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    update(
                      "ruleSets",
                      draft.ruleSets.filter((_, itemIndex) =>
                        itemIndex !== index
                      ),
                    )}
                >
                  移除
                </button>
              )}
            </header>
            <div className="requirement-form-grid">
              <label>
                <span>开始日期</span>
                <input
                  type="date"
                  value={rule.effectiveFrom}
                  onChange={event =>
                    updateRule(index, { effectiveFrom: event.target.value })}
                />
              </label>
              <label>
                <span>结束日期</span>
                <input
                  type="date"
                  value={rule.effectiveTo ?? ""}
                  onChange={event =>
                    updateRule(index, {
                      effectiveTo: event.target.value || undefined,
                    })}
                />
              </label>
              <label>
                <span>人群模式</span>
                <select
                  value={rule.audienceMode}
                  onChange={event =>
                    updateRule(index, {
                      audienceMode: event.target.value as
                        | "all_employees"
                        | "structured_scope",
                    })}
                >
                  <option value="all_employees">酒店全体</option>
                  <option value="structured_scope">指定组织与职位条件</option>
                </select>
              </label>
              <label>
                <span>新员工条件</span>
                <select
                  value={rule.newEmployeeCondition}
                  onChange={event =>
                    updateRule(index, {
                      newEmployeeCondition: event.target.value as
                        EligibilityRuleSetDraft["newEmployeeCondition"],
                    })}
                >
                  <option value="not_evaluated">不作为条件</option>
                  <option value="required">仅新员工</option>
                  <option value="excluded">排除新员工</option>
                </select>
              </label>
            </div>
            <fieldset className="nested-checks">
              <legend>员工状态</legend>
              {["active", "leave", "inactive", "terminated"].map(statusValue => (
                <label className="requirement-check" key={statusValue}>
                  <input
                    type="checkbox"
                    checked={rule.employmentStatuses.includes(statusValue)}
                    onChange={() =>
                      updateRule(index, {
                        employmentStatuses: toggle(
                          rule.employmentStatuses,
                          statusValue,
                        ),
                      })}
                  />
                  <span>{employmentStatusLabel(statusValue)}</span>
                </label>
              ))}
            </fieldset>
            {rule.audienceMode === "structured_scope" && (
              <div className="scope-rule-grid">
                <ScopeChecks
                  title="正式部门分支"
                  options={departments.filter(item => item.isActive).map(item => ({
                    id: item.id,
                    label: item.nameZh,
                  }))}
                  selected={rule.departments.map(item => item.departmentId)}
                  onToggle={id =>
                    updateRule(index, {
                      departments: rule.departments.some(
                          item => item.departmentId === id,
                        )
                        ? rule.departments.filter(
                          item => item.departmentId !== id,
                        )
                        : [
                            ...rule.departments,
                            { departmentId: id, includeDescendants: true },
                          ],
                    })}
                />
                <ScopeChecks
                  title="正式职位"
                  options={positions.filter(item => item.isActive).map(item => ({
                    id: item.id,
                    label: item.nameZh,
                  }))}
                  selected={rule.positionIds}
                  onToggle={id =>
                    updateRule(index, {
                      positionIds: toggle(rule.positionIds, id),
                    })}
                />
                <ScopeChecks
                  title="职位族"
                  options={positionFamilies.filter(item => item.isActive).map(
                    item => ({ id: item.id, label: item.nameZh }),
                  )}
                  selected={rule.positionFamilyIds}
                  onToggle={id =>
                    updateRule(index, {
                      positionFamilyIds: toggle(rule.positionFamilyIds, id),
                    })}
                />
              </div>
            )}
          </article>
        ))}
        <button
          type="button"
          className="quiet-button"
          onClick={() =>
            update("ruleSets", [
              ...draft.ruleSets,
              blankRule(draft.effectiveFrom, draft.effectiveTo),
            ])}
        >
          + 添加不重叠的未来规则期间
        </button>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>版本治理</legend>
        <div className="requirement-form-grid">
          <label>
            <span>变更原因</span>
            <input
              value={draft.changeReason}
              onChange={event => update("changeReason", event.target.value)}
            />
          </label>
          <label>
            <span>为何仍属于同一义务</span>
            <input
              value={draft.continuityRationale}
              onChange={event =>
                update("continuityRationale", event.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <div className="obligation-boundary">
        <strong>D1 边界</strong>
        <span>
          适用性评估只判断某日是否适用，不创建员工任务、分配、逾期、提醒或完成事实。
        </span>
      </div>

      <footer className="requirement-editor-actions">
        {!immutable && (
          <button
            type="button"
            className="primary-action"
            disabled={phase === "saving"}
            onClick={() => void saveRequirementVersionDraft()}
          >
            保存培训要求草稿
          </button>
        )}
        {initial?.state === "draft" && !dirty && (
          <button
            type="button"
            onClick={() => void transitionRequirementVersion("approved")}
          >
            批准版本
          </button>
        )}
        {initial?.state === "approved" && (
          <>
            <button
              type="button"
              onClick={() => void transitionRequirementVersion("effective")}
            >
              设为生效
            </button>
            <button
              type="button"
              onClick={() => void transitionRequirementVersion("retired")}
            >
              停用版本
            </button>
          </>
        )}
        {initial && ["effective", "superseded"].includes(initial.state) && (
          <button
            type="button"
            onClick={() => void transitionRequirementVersion("retired")}
          >
            停用版本
          </button>
        )}
      </footer>
    </section>
  );
}

function LearningMethodEditor({
  method,
  publishedCourses,
  onChange,
  onRemove,
}: {
  method: AcceptedLearningMethodDraft;
  publishedCourses: CourseVersion[];
  onChange: (method: AcceptedLearningMethodDraft) => void;
  onRemove: () => void;
}) {
  const patch = (values: Record<string, unknown>) =>
    onChange({ ...method, ...values } as AcceptedLearningMethodDraft);
  return (
    <article className="learning-method-card">
      <header>
        <strong>{methodTypeLabel(method.type)}</strong>
        <button type="button" onClick={onRemove}>移除</button>
      </header>
      <label>
        <span>业务名称</span>
        <input
          value={method.labelZh}
          onChange={event => patch({ labelZh: event.target.value })}
        />
      </label>
      {method.type === "course_version" && (
        <label>
          <span>已发布课程版本</span>
          <select
            value={method.courseVersionId}
            onChange={event => patch({ courseVersionId: event.target.value })}
          >
            <option value="">请选择</option>
            {publishedCourses.map(course => (
              <option key={course.id} value={course.id}>
                {course.nameZh} · V{course.versionNumber}
              </option>
            ))}
          </select>
        </label>
      )}
      {method.type === "external_certificate" && (
        <div className="requirement-form-grid">
          <label><span>证书类型</span><input value={method.certificateType} onChange={event => patch({ certificateType: event.target.value })} /></label>
          <label><span>认可签发标准</span><input value={method.issuerCriteria} onChange={event => patch({ issuerCriteria: event.target.value })} /></label>
          <label><span>有效月数（可选）</span><input type="number" min="1" value={method.validityMonths ?? ""} onChange={event => patch({ validityMonths: event.target.value ? Number(event.target.value) : undefined })} /></label>
          <label><span>证据要求</span><input value={method.evidenceDescription} onChange={event => patch({ evidenceDescription: event.target.value })} /></label>
        </div>
      )}
      {method.type === "assessment" && (
        <div className="requirement-form-grid">
          <label><span>评估名称</span><input value={method.assessmentName} onChange={event => patch({ assessmentName: event.target.value })} /></label>
          <label><span>通过标准</span><input value={method.passCriteria} onChange={event => patch({ passCriteria: event.target.value })} /></label>
          <label><span>证据要求</span><input value={method.evidenceDescription} onChange={event => patch({ evidenceDescription: event.target.value })} /></label>
        </div>
      )}
      {method.type === "manager_equivalency" && (
        <div className="requirement-form-grid">
          <label><span>等价证据要求</span><input value={method.evidenceDescription} onChange={event => patch({ evidenceDescription: event.target.value })} /></label>
          <label><span>批准标准</span><input value={method.approvalStandard} onChange={event => patch({ approvalStandard: event.target.value })} /></label>
        </div>
      )}
    </article>
  );
}

function ScopeChecks({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string;
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <fieldset className="nested-checks">
      <legend>{title}</legend>
      {options.length === 0 && <small>当前没有可用项目</small>}
      {options.map(option => (
        <label className="requirement-check" key={option.id}>
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={() => onToggle(option.id)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function emptyRequirementDraft(propertyId: string): RequirementVersionDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    propertyId,
    expectedVersion: 0,
    code: "",
    nameZh: "",
    nameEn: "",
    purpose: "",
    obligationExplanation: "",
    effectiveFrom: today,
    effectiveTo: undefined,
    changeReason: "",
    continuityRationale: "",
    timing: { type: "calendar_recurrence", period: "year" },
    completionDefinition: {
      satisfactionOperator: "any_one",
      methods: [],
    },
    ruleSets: [blankRule(today)],
  };
}

function requirementDraftFrom(
  value: RequirementVersion,
): RequirementVersionDraft {
  return {
    propertyId: value.propertyId,
    requirementId: value.requirementId,
    requirementVersionId: value.id,
    expectedVersion: value.expectedVersion,
    code: value.code,
    nameZh: value.nameZh,
    nameEn: value.nameEn,
    purpose: value.purpose,
    obligationExplanation: value.obligationExplanation,
    effectiveFrom: value.effectiveFrom,
    effectiveTo: value.effectiveTo,
    changeReason: value.changeReason,
    continuityRationale: value.continuityRationale,
    timing: structuredClone(value.timing),
    completionDefinition: structuredClone(value.completionDefinition),
    ruleSets: structuredClone(value.ruleSets),
  };
}

function nextRequirementDraftFrom(
  value: RequirementVersion,
): RequirementVersionDraft {
  return {
    ...requirementDraftFrom(value),
    requirementVersionId: undefined,
    expectedVersion: value.identityVersion,
    changeReason: "",
    ruleSets: structuredClone(value.ruleSets).map(rule => ({
      ...rule,
      id: undefined,
    })),
    completionDefinition: {
      satisfactionOperator: "any_one",
      methods: structuredClone(value.completionDefinition.methods).map(
        method => ({ ...method, id: undefined }),
      ),
    },
  };
}

function blankRule(
  effectiveFrom: string,
  effectiveTo?: string,
): EligibilityRuleSetDraft {
  return {
    effectiveFrom,
    effectiveTo,
    audienceMode: "all_employees",
    departments: [],
    positionIds: [],
    positionFamilyIds: [],
    newEmployeeCondition: "not_evaluated",
    employmentStatuses: ["active"],
  };
}

function blankMethod(
  type: AcceptedLearningMethodDraft["type"],
): AcceptedLearningMethodDraft {
  if (type === "course_version") {
    return { type, labelZh: "完成已发布课程", courseVersionId: "" };
  }
  if (type === "external_certificate") {
    return {
      type,
      labelZh: "提交认可的外部证书",
      certificateType: "",
      issuerCriteria: "",
      evidenceDescription: "",
    };
  }
  if (type === "assessment") {
    return {
      type,
      labelZh: "通过受控评估",
      assessmentName: "",
      evidenceDescription: "",
      passCriteria: "",
    };
  }
  return {
    type,
    labelZh: "经理批准等价认定",
    evidenceDescription: "",
    approvalStandard: "",
  };
}

function timingFor(type: string): RequirementTimingDefinition {
  if (type === "fixed_date") {
    return { type, dueDate: new Date().toISOString().slice(0, 10) };
  }
  if (type === "hire_relative") return { type, dueWithinDays: 30 };
  if (type === "interval_months") {
    return {
      type,
      intervalMonths: 12,
      anchorDate: new Date().toISOString().slice(0, 10),
    };
  }
  return { type: "calendar_recurrence", period: "year" };
}

function toggle(values: string[], value: string) {
  return values.includes(value)
    ? values.filter(item => item !== value)
    : [...values, value];
}

function employmentStatusLabel(value: string) {
  return {
    active: "在职",
    leave: "休假",
    inactive: "非活动",
    terminated: "已离职",
  }[value] ?? value;
}

function methodTypeLabel(value: AcceptedLearningMethodDraft["type"]) {
  return {
    course_version: "已发布课程版本",
    external_certificate: "认可外部证书",
    assessment: "受控评估／考试",
    manager_equivalency: "经理等价认定定义",
  }[value];
}

function normalizedCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function isConflict(error: unknown) {
  return error instanceof Error &&
    (error.name === "ConflictError" || /重新读取|版本/.test(error.message));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试。";
}
