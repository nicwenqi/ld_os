import type { InitializationRepository, SaveWizardStepInput } from "../contracts/initialization-repository.ts";
import type { WizardProgress } from "../../services/initialization-wizard-service.ts";

type Progress = WizardProgress & { version: number; completedAt: string | null };

export function createHttpInitializationRepository(): InitializationRepository {
  return {
    getProgress: () => request<Progress>("/api/initialization/progress"),
    saveNavigation: (_propertyId, lastActiveStep, expectedVersion = 0) => request<Progress>("/api/initialization/progress", json("PATCH", { action: "navigation", lastActiveStep, expectedVersion })),
    saveStep: (input: SaveWizardStepInput) => request<Progress>("/api/initialization/progress", json("PATCH", { action: "step", stepKey: input.stepKey, lastActiveStep: input.lastActiveStep, explicitlyConfirmed: input.explicitlyConfirmed ?? false, warning: input.warning ?? null, blockingReason: input.blockingReason ?? null, expectedVersion: input.expectedVersion ?? 0 })),
    complete: (_propertyId, expectedVersion = 0) => request<void>("/api/initialization/complete", json("POST", { expectedVersion })),
    getAccessSummary: () => request("/api/initialization/access"),
  };
}

function json(method: "PATCH" | "POST", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
  const payload = await response.json() as T & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "初始化服务暂时不可用");
  return payload;
}
