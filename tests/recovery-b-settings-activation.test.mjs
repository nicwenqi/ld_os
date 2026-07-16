import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveWizardState } from "../app/services/initialization-wizard-service.ts";
import {
  isSaveConflict,
  saveStateKind,
  saveStateLabel,
} from "../app/services/save-state.ts";
import {
  validateBusinessRules,
  validatePropertyIdentity,
} from "../app/services/property-settings-service.ts";
import {
  getMockProperty,
  saveMockLogo,
} from "../app/api/mock-property/store.ts";

const identity = {
  nameZh: "示范酒店",
  nameEn: "Synthetic Hotel",
  shortName: "示范酒店",
  code: "demo-01",
  brand: "Demo",
  city: "测试城市",
  countryRegion: "CN",
  timezone: "Asia/Shanghai",
  defaultLanguage: "zh-CN",
};
const rules = {
  newEmployeeDays: 90,
  probationFieldMeaning: "confirmation_date",
  employeeStatusSource: "manual",
  ctcMandatory: true,
  gtcMandatory: true,
};
const baseFacts = {
  identity,
  rules,
  activeDepartments: 1,
  activePositions: 0,
  inspectedEmployeeMaster: false,
  unresolvedDepartmentLabels: 2,
  unresolvedPositionLabels: 3,
  activePropertyAdministrator: true,
  progress: { lastActiveStep: 5, steps: {}, completedAt: null, state: "in_progress" },
};

test("finite activation has five business sections and optional employee readiness does not block activation", () => {
  const state = deriveWizardState(baseFacts);
  assert.deepEqual(state.steps.map(step => step.label), [
    "酒店信息与规则",
    "正式部门",
    "管理员账号",
    "员工资料准备",
    "启用复核",
  ]);
  assert.equal(state.minimumReady, true);
  assert.equal(state.ready, true);
  assert.equal(state.operationalReady, false);
  assert.equal(state.steps[3].complete, false);
  assert.equal(state.steps[3].blocked, false);
  assert.match(state.steps[3].detail, /不会阻塞酒店启用/);
  assert.equal(state.lastIncompleteStep, 5);
});

test("completed activation remains reviewable and does not downgrade when later maintenance is needed", () => {
  const state = deriveWizardState({
    ...baseFacts,
    activeDepartments: 0,
    activePropertyAdministrator: false,
    progress: {
      lastActiveStep: 5,
      steps: {},
      completedAt: "2026-07-16T08:00:00.000Z",
      state: "ready",
    },
  });
  assert.equal(state.activationCompleted, true);
  assert.equal(state.ready, true);
  assert.equal(state.requiresMaintenance, true);
  assert.match(state.activationConclusion, /已启用/);
  assert.doesNotMatch(state.activationConclusion, /未启用/);
});

test("save state distinguishes conflicts from retryable failures", () => {
  const conflict = {
    saving: false,
    dirty: false,
    error: "酒店设置已被其他管理员更新，请刷新后重试",
    savedAt: null,
  };
  assert.equal(isSaveConflict(conflict.error), true);
  assert.equal(saveStateKind(conflict), "conflict");
  assert.equal(saveStateLabel(conflict), "保存冲突，请重新读取");
  assert.equal(saveStateKind({ ...conflict, error: "网络中断" }), "failed");
  assert.equal(saveStateLabel({ ...conflict, error: "网络中断" }), "保存失败，点击重试");
});

test("hotel settings validation uses business-facing required-field and range messages", () => {
  assert.throws(
    () => validatePropertyIdentity({ ...identity, nameZh: " " }),
    /请输入酒店正式中文名称/,
  );
  assert.throws(
    () => validateBusinessRules({ ...rules, newEmployeeDays: 366 }),
    /1 至 365 天/,
  );
  assert.doesNotThrow(() => validatePropertyIdentity(identity));
  assert.doesNotThrow(() => validateBusinessRules(rules));
});

test("settings and activation pages re-read authoritative state and guard unsaved navigation", async () => {
  const [settings, activation, accessStep, organizationStep, guard] = await Promise.all([
    readFile(new URL("../app/settings/hotel/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/AccessSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/initialize/OrganizationSetupStep.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/services/use-unsaved-changes-guard.ts", import.meta.url), "utf8"),
  ]);
  for (const source of [settings, activation]) {
    assert.match(source, /useUnsavedChangesGuard/);
    assert.match(source, /getProperty/);
    assert.match(source, /重新读取/);
  }
  assert.match(guard, /beforeunload/);
  assert.match(guard, /document\.addEventListener\(["']click["']/);
  assert.match(settings, /保存酒店信息/);
  assert.match(settings, /酒店启用/);
  assert.doesNotMatch(settings, /初始化进度/);
  assert.match(activation, /共 5 个部分/);
  assert.match(activation, /员工资料准备不会阻塞酒店启用/);
  assert.match(accessStep, /href=["']\/accounts["']/);
  assert.match(activation, /runOperation=\{runAction\}/);
  assert.match(organizationStep, /runOperation/);
  assert.match(organizationStep, /disabled=\{saving\}/);
  assert.doesNotMatch(activation, /progressPercent|共 8 步|初始化进度/);
});

test("local-review logo replacement survives an authoritative property re-read", () => {
  const asset = saveMockLogo({
    tenantId: "10000000-0000-0000-0000-000000000001",
    propertyId: "20000000-0000-0000-0000-000000000011",
    fileName: "hotel.png",
    mimeType: "image/png",
    byteSize: 4,
    dataUrl: "data:image/png;base64,iVBORw==",
  });
  const reread = getMockProperty();
  assert.equal(reread.currentLogo?.id, asset.id);
  assert.equal(reread.currentLogo?.publicUrl, "data:image/png;base64,iVBORw==");
});

test("mobile hotel settings keep editable and maintenance actions at practical touch heights", async () => {
  const [settingsCss, administrationCss, activationCss] = await Promise.all([
    readFile(new URL("../app/checkpoint-2c-a.css", import.meta.url), "utf8"),
    readFile(new URL("../app/recovery-b.css", import.meta.url), "utf8"),
    readFile(new URL("../app/initialization-wizard.css", import.meta.url), "utf8"),
  ]);
  assert.match(settingsCss, /\.number-input input\{min-height:44px\}/);
  assert.match(settingsCss, /\.cleanup-button\{min-height:44px/);
  assert.match(settingsCss, /\.logo-upload-button\{min-height:44px/);
  assert.match(
    administrationCss,
    /\.department-scope-editor article>label:first-child,.scope-descendants\{min-height:44px\}/,
  );
  assert.match(
    activationCss,
    /\.wizard-top-status,.wizard-return,.wizard-top-actions button,.wizard-save-alert button,.readiness-list button\{min-height:44px/,
  );
});
