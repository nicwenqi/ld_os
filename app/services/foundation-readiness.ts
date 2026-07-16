import type { AppDataMode } from "../lib/environment.ts";
import type { AuthSession } from "../repositories/contracts/auth-repository.ts";
import type { createRepositoryRegistry } from "../repositories/registry.ts";
import { deriveWizardState } from "./initialization-wizard-service.ts";

type Registry = ReturnType<typeof createRepositoryRegistry>;
export type FoundationPresentationState = "real" | "demo" | "partial";

export type FoundationReadinessSnapshot = {
  presentationState: FoundationPresentationState;
  refreshedAt: string;
  hotel: {
    nameZh: string;
    nameEn: string;
    timezone: string;
  };
  readiness: {
    minimumReady: boolean | null;
    foundationReady: boolean | null;
    blockers: string[];
    nextAction: { title: string; detail: string; href: string };
  };
  facts: {
    activeDepartments: number | null;
    activePositions: number | null;
    activeEmployees: number | null;
    unresolvedMappings: number | null;
    activeManagers: number | null;
    latestEmployeeUpdate: { status: string; createdAt: string } | null;
  };
  errors: string[];
};

export async function loadFoundationReadiness(
  registry: Registry,
  session: AuthSession,
): Promise<FoundationReadinessSnapshot> {
  const propertyId = await resolvePropertyId(registry, session);
  if (!propertyId) {
    return failedSnapshot(registry.environment.dataMode, session, "当前酒店上下文无法读取");
  }

  const results = await Promise.allSettled([
    registry.property.getProperty(propertyId),
    registry.department.listTree(propertyId),
    registry.position.listPositions(propertyId),
    registry.department.listAliases(propertyId),
    registry.position.listSourceLabels(propertyId),
    registry.employee.listEmployees(propertyId, { active: true }),
    registry.import.listImportHistory(propertyId),
    registry.initialization.getProgress(propertyId),
    registry.initialization.getAccessSummary(propertyId),
  ]);
  const [
    propertyResult,
    treeResult,
    positionsResult,
    aliasesResult,
    positionLabelsResult,
    employeesResult,
    batchesResult,
    progressResult,
    accessResult,
  ] = results;
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map(result => message(result.reason));

  const property = fulfilled(propertyResult) ? propertyResult.value : null;
  const tree = fulfilled(treeResult) ? treeResult.value : null;
  const positions = fulfilled(positionsResult) ? positionsResult.value : null;
  const aliases = fulfilled(aliasesResult) ? aliasesResult.value : null;
  const positionLabels = fulfilled(positionLabelsResult) ? positionLabelsResult.value : null;
  const employees = fulfilled(employeesResult) ? employeesResult.value : null;
  const batches = fulfilled(batchesResult) ? batchesResult.value : null;
  const progress = fulfilled(progressResult) ? progressResult.value : null;
  const access = fulfilled(accessResult) ? accessResult.value : null;
  const activeDepartments = tree ? tree.filter(node => node.isActive).length : null;
  const activePositions = positions ? positions.filter(position => position.isActive).length : null;
  const activeEmployees = employees ? employees.length : null;
  const unresolvedMappings =
    aliases && positionLabels
      ? aliases.filter(alias => alias.resolutionType === "deferred").length +
        positionLabels.filter(label => label.resolutionStatus === "deferred").length
      : null;
  const latestEmployeeUpdate = batches?.length
    ? [...batches]
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .map(batch => ({ status: batch.status, createdAt: batch.createdAt }))[0]
    : null;

  const canDerive = Boolean(
    property &&
      tree &&
      positions &&
      aliases &&
      positionLabels &&
      batches &&
      progress &&
      access,
  );
  const wizard = canDerive
    ? deriveWizardState({
        identity: property!.identity,
        rules: property!.settings,
        activeDepartments: activeDepartments!,
        activePositions: activePositions!,
        inspectedEmployeeMaster: batches!.some(batch =>
          [
            "mapping_required",
            "validating",
            "ready_for_review",
            "importing",
            "completed",
            "completed_with_warnings",
          ].includes(batch.status),
        ),
        unresolvedDepartmentLabels: aliases!.filter(
          alias => alias.resolutionType === "deferred",
        ).length,
        unresolvedPositionLabels: positionLabels!.filter(
          label => label.resolutionStatus === "deferred",
        ).length,
        activePropertyAdministrator: Boolean(access!.activePropertyManagers),
        progress: progress!,
      })
    : null;

  return {
    presentationState: foundationPresentationState(
      registry.environment.dataMode,
      errors.length > 0,
    ),
    refreshedAt: new Date().toISOString(),
    hotel: {
      nameZh: property?.identity.nameZh ?? session.propertyNameZh ?? "当前酒店",
      nameEn: property?.identity.nameEn ?? session.propertyNameEn ?? "Hotel property",
      timezone: property?.identity.timezone ?? "Asia/Shanghai",
    },
    readiness: {
      minimumReady: wizard?.minimumReady ?? null,
      foundationReady: wizard?.operationalReady ?? null,
      blockers: wizard?.operationalBlockingReasons ?? errors,
      nextAction: nextAction(wizard?.nextRecommendedAction, errors.length > 0),
    },
    facts: {
      activeDepartments,
      activePositions,
      activeEmployees,
      unresolvedMappings,
      activeManagers: access ? access.activePropertyManagers : null,
      latestEmployeeUpdate,
    },
    errors,
  };
}

export function formatFoundationCount(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : String(value);
}

export function foundationPresentationState(
  dataMode: AppDataMode,
  hasErrors: boolean,
): FoundationPresentationState {
  if (hasErrors) return "partial";
  return dataMode === "mock" ? "demo" : "real";
}

async function resolvePropertyId(registry: Registry, session: AuthSession) {
  if (registry.environment.dataMode !== "mock") return session.propertyId;
  try {
    return (await registry.property.resolveContext("training-demo.example.test"))?.propertyId ?? null;
  } catch {
    return null;
  }
}

function nextAction(recommendation: string | undefined, hasErrors: boolean) {
  if (hasErrors) {
    return {
      title: "检查基础数据连接",
      detail: "先恢复无法读取的酒店基础事实，再继续运营准备。",
      href: "/data-quality",
    };
  }
  if (!recommendation || recommendation === "进入系统") {
    return {
      title: "核对员工与组织基础",
      detail: "培训事实接入前，保持员工主数据、正式部门和职位归属准确。",
      href: "/data-quality",
    };
  }
  if (/酒店基本信息|业务规则/.test(recommendation)) {
    return { title: recommendation, detail: "完善酒店身份与培训业务口径。", href: "/settings/hotel" };
  }
  if (/管理员|访问/.test(recommendation)) {
    return { title: recommendation, detail: "确认酒店管理员及部门授权安排。", href: "/permissions?section=access" };
  }
  if (/工作簿|员工主数据/.test(recommendation)) {
    return { title: recommendation, detail: "检查员工资料文件，不导入培训历史。", href: "/import" };
  }
  if (/组织|职位|映射|来源标签/.test(recommendation)) {
    return { title: recommendation, detail: "维护正式组织、职位与来源归属。", href: "/permissions?section=organization" };
  }
  return { title: recommendation, detail: "继续酒店基础启用检查。", href: "/initialize" };
}

function fulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === "fulfilled";
}

function message(reason: unknown) {
  return reason instanceof Error ? reason.message : "基础数据读取失败";
}

function failedSnapshot(
  dataMode: AppDataMode,
  session: AuthSession,
  error: string,
): FoundationReadinessSnapshot {
  return {
    presentationState: foundationPresentationState(dataMode, true),
    refreshedAt: new Date().toISOString(),
    hotel: {
      nameZh: session.propertyNameZh ?? "当前酒店",
      nameEn: session.propertyNameEn ?? "Hotel property",
      timezone: "Asia/Shanghai",
    },
    readiness: {
      minimumReady: null,
      foundationReady: null,
      blockers: [error],
      nextAction: {
        title: "检查酒店访问上下文",
        detail: "酒店基础事实不可用，暂不生成任何运营判断。",
        href: "/data-quality",
      },
    },
    facts: {
      activeDepartments: null,
      activePositions: null,
      activeEmployees: null,
      unresolvedMappings: null,
      activeManagers: null,
      latestEmployeeUpdate: null,
    },
    errors: [error],
  };
}
