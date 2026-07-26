"use client";

import { useMemo, useState } from "react";
import {
  AdministrationSaveState,
  savedTime,
  type AdministrationSavePhase,
  useUnsavedChangesWarning,
} from "../administration/AdministrationSaveState";
import type {
  CourseVersion,
  CourseVersionDraft,
  CourseVersionState,
  LearningRequirementRepository,
} from "../../repositories/contracts/learning-requirement-repository.ts";
import { validateCourseVersionDraft } from "../../services/learning-requirement-service.ts";

export function CourseVersionEditor({
  propertyId,
  repository,
  initial,
  newVersionOf,
  onSaved,
  onClose,
}: {
  propertyId: string;
  repository: LearningRequirementRepository;
  initial?: CourseVersion | null;
  newVersionOf?: CourseVersion | null;
  onSaved: (value: CourseVersion) => Promise<void> | void;
  onClose: () => void;
}) {
  const baseline = useMemo(
    () =>
      initial
        ? courseDraftFrom(initial)
        : newVersionOf
          ? nextCourseDraftFrom(newVersionOf)
          : emptyCourseDraft(propertyId),
    [initial, newVersionOf, propertyId],
  );
  const [draft, setDraft] = useState<CourseVersionDraft>(baseline);
  const [phase, setPhase] =
    useState<AdministrationSavePhase>("pristine");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const immutable = Boolean(
    initial && initial.state !== "draft",
  );
  const dirty = phase === "dirty";
  useUnsavedChangesWarning(dirty, "课程版本有未保存更改");

  const update = <K extends keyof CourseVersionDraft>(
    key: K,
    value: CourseVersionDraft[K],
  ) => {
    setDraft(current => ({ ...current, [key]: value }));
    setPhase("dirty");
    setStatus("课程版本尚未保存");
  };

  const saveCourseVersionDraft = async () => {
    const errors = validateCourseVersionDraft(draft);
    if (errors.length > 0) {
      setPhase("failed");
      setStatus(errors.join(" "));
      return;
    }
    try {
      setPhase("saving");
      setStatus("正在保存课程版本并重新读取服务器状态");
      const saved = await repository.saveCourseVersionDraft(draft);
      setDraft(courseDraftFrom(saved));
      setPhase("saved");
      setSavedAt(savedTime());
      setStatus("课程草稿已保存并重新读取服务器状态");
      await onSaved(saved);
    } catch (error) {
      setPhase(isConflict(error) ? "conflict" : "failed");
      setStatus(message(error));
    }
  };

  const transitionCourseVersion = async (
    target: CourseVersionState,
  ) => {
    if (!initial) return;
    const reason = target === "draft" || target === "retired"
      ? window.prompt("请说明此次退回或停用原因")
      : null;
    if ((target === "draft" || target === "retired") && !reason?.trim()) {
      setPhase("failed");
      setStatus("退回或停用版本必须说明原因。");
      return;
    }
    try {
      setPhase("saving");
      setStatus("正在更新版本状态并重新读取服务器状态");
      const saved = await repository.transitionCourseVersion(
        initial.id,
        target,
        initial.expectedVersion,
        reason ?? undefined,
      );
      setDraft(courseDraftFrom(saved));
      setPhase("saved");
      setSavedAt(savedTime());
      setStatus("课程版本状态已更新并重新读取服务器状态");
      await onSaved(saved);
    } catch (error) {
      setPhase(isConflict(error) ? "conflict" : "failed");
      setStatus(message(error));
    }
  };

  return (
    <section className="requirement-editor" aria-labelledby="course-editor-title">
      <header>
        <div>
          <span>LEARNING METHOD FOUNDATION</span>
          <h2 id="course-editor-title">
            {initial
              ? `${initial.nameZh} · V${initial.versionNumber}`
              : newVersionOf
                ? `${newVersionOf.nameZh} · 建立 V${newVersionOf.versionNumber + 1}`
                : "建立课程版本"}
          </h2>
          <p>课程版本是履行培训要求的一种学习方式，不是酒店义务本身。</p>
        </div>
        <button type="button" className="quiet-button" onClick={onClose}>
          关闭
        </button>
      </header>

      <AdministrationSaveState
        phase={phase}
        savedAt={savedAt}
        message={status}
        onRetry={() => void saveCourseVersionDraft()}
        onReload={onClose}
      />

      {immutable && (
        <div className="immutable-notice">
          <strong>已发布版本不可编辑</strong>
          <span>需要调整内容或能力目标时，请在课程主体下创建新版本。</span>
        </div>
      )}

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>课程主体</legend>
        <div className="requirement-form-grid">
          <label>
            <span>课程代码</span>
            <input
              value={draft.code}
              onChange={event =>
                update("code", normalizedCode(event.target.value))}
              placeholder="FIRE-SAFETY"
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
            <span>标准时长（分钟）</span>
            <input
              type="number"
              min="1"
              value={draft.standardDurationMinutes}
              onChange={event =>
                update(
                  "standardDurationMinutes",
                  Number(event.target.value),
                )}
            />
          </label>
        </div>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>内容身份</legend>
        <label>
          <span>课程描述</span>
          <textarea
            value={draft.description}
            onChange={event => update("description", event.target.value)}
          />
        </label>
        <label>
          <span>课程大纲</span>
          <textarea
            value={draft.outline}
            onChange={event => update("outline", event.target.value)}
          />
        </label>
        <label>
          <span>学习材料版本</span>
          <input
            value={draft.learningMaterialVersion}
            onChange={event =>
              update("learningMaterialVersion", event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>能力身份</legend>
        <label>
          <span>能力目标（每行一个）</span>
          <textarea
            value={draft.learningObjectives.join("\n")}
            onChange={event =>
              update("learningObjectives", lines(event.target.value))}
          />
        </label>
        <label>
          <span>能力标签（每行一个）</span>
          <textarea
            value={draft.capabilityTags.join("\n")}
            onChange={event =>
              update("capabilityTags", lines(event.target.value))}
          />
        </label>
        <label>
          <span>评估标准</span>
          <textarea
            value={draft.assessmentCriteria}
            onChange={event =>
              update("assessmentCriteria", event.target.value)}
          />
        </label>
      </fieldset>

      <fieldset disabled={immutable || phase === "saving"}>
        <legend>版本连续性</legend>
        <div className="requirement-form-grid">
          <label>
            <span>变更原因</span>
            <input
              value={draft.changeReason}
              onChange={event => update("changeReason", event.target.value)}
            />
          </label>
          <label>
            <span>为何仍属于同一课程主体</span>
            <input
              value={draft.continuityRationale}
              onChange={event =>
                update("continuityRationale", event.target.value)}
            />
          </label>
        </div>
        <label className="requirement-check">
          <input
            type="checkbox"
            checked={draft.impactReviewRequired}
            onChange={event =>
              update("impactReviewRequired", event.target.checked)}
          />
          <span>现有要求或历史完成在未来实施中需要人工复核</span>
        </label>
        <label>
          <span>影响说明（仅元数据，不触发重新培训）</span>
          <textarea
            value={draft.impactNote ?? ""}
            onChange={event => update("impactNote", event.target.value)}
          />
        </label>
      </fieldset>

      <footer className="requirement-editor-actions">
        {!immutable && (
          <button
            type="button"
            className="primary-action"
            disabled={phase === "saving"}
            onClick={() => void saveCourseVersionDraft()}
          >
            保存课程草稿
          </button>
        )}
        {initial?.state === "draft" && !dirty && (
          <button type="button" onClick={() => void transitionCourseVersion("review")}>
            提交复核
          </button>
        )}
        {initial?.state === "review" && !dirty && (
          <>
            <button type="button" onClick={() => void transitionCourseVersion("published")}>
              发布版本
            </button>
            <button type="button" onClick={() => void transitionCourseVersion("draft")}>
              退回草稿
            </button>
          </>
        )}
        {initial?.state === "published" && (
          <button type="button" onClick={() => void transitionCourseVersion("retired")}>
            停用版本
          </button>
        )}
      </footer>
    </section>
  );
}

function emptyCourseDraft(propertyId: string): CourseVersionDraft {
  return {
    propertyId,
    expectedVersion: 0,
    code: "",
    nameZh: "",
    nameEn: "",
    description: "",
    outline: "",
    learningMaterialVersion: "",
    standardDurationMinutes: 60,
    learningObjectives: [],
    capabilityTags: [],
    assessmentCriteria: "",
    changeReason: "",
    continuityRationale: "",
    impactReviewRequired: false,
    impactNote: "",
  };
}

function courseDraftFrom(value: CourseVersion): CourseVersionDraft {
  return {
    propertyId: value.propertyId,
    courseId: value.courseId,
    courseVersionId: value.id,
    expectedVersion: value.expectedVersion,
    code: value.code,
    nameZh: value.nameZh,
    nameEn: value.nameEn,
    description: value.description,
    outline: value.outline,
    learningMaterialVersion: value.learningMaterialVersion,
    standardDurationMinutes: value.standardDurationMinutes,
    learningObjectives: [...value.learningObjectives],
    capabilityTags: [...value.capabilityTags],
    assessmentCriteria: value.assessmentCriteria,
    changeReason: value.changeReason,
    continuityRationale: value.continuityRationale,
    impactReviewRequired: value.impactReviewRequired,
    impactNote: value.impactNote,
  };
}

function nextCourseDraftFrom(value: CourseVersion): CourseVersionDraft {
  return {
    ...courseDraftFrom(value),
    courseVersionId: undefined,
    expectedVersion: value.identityVersion,
    changeReason: "",
    impactReviewRequired: false,
    impactNote: "",
  };
}

function lines(value: string) {
  return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
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
