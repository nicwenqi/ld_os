import type { InitializationRepository, SaveWizardStepInput } from "../contracts/initialization-repository.ts";
const propertyId = "20000000-0000-0000-0000-000000000011";
let state = { lastActiveStep: 1, steps: {}, version: 1, completedAt: null as string | null };
export function createMockInitializationRepository(): InitializationRepository { return {
  async getProgress(id) { if (id !== propertyId) throw new Error("未找到当前酒店初始化资料"); return structuredClone(state); },
  async saveStep(input: SaveWizardStepInput) { if (input.propertyId !== propertyId) throw new Error("无权修改其他酒店初始化资料"); if (input.expectedVersion && input.expectedVersion !== state.version) throw new Error("初始化进度已更新，请刷新后重试"); state = { ...state, lastActiveStep: input.lastActiveStep, steps: { ...state.steps, [input.stepKey]: { ...state.steps[input.stepKey], explicitlyConfirmed: input.explicitlyConfirmed ?? state.steps[input.stepKey]?.explicitlyConfirmed, warning: input.warning ?? state.steps[input.stepKey]?.warning ?? null, blockingReason: input.blockingReason ?? state.steps[input.stepKey]?.blockingReason ?? null } }, version: state.version + 1 }; return structuredClone(state); },
  async complete(id) { if (id !== propertyId) throw new Error("无权完成其他酒店初始化"); state = { ...state, completedAt: new Date().toISOString(), version: state.version + 1 }; },
}; }
