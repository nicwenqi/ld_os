import type { WizardProgress, WizardStepKey } from "../../services/initialization-wizard-service.ts";
export type SaveWizardStepInput = { propertyId: string; stepKey: WizardStepKey; lastActiveStep: number; explicitlyConfirmed?: boolean; warning?: string | null; blockingReason?: string | null; expectedVersion?: number };
export type InitializationAccessSummary = {
  currentManager: { displayName: string; loginId: string; accountStatus: string } | null;
  activePropertyManagers: number;
  activeDepartmentAdministrators: number;
  canConfirm: boolean;
};
export interface InitializationRepository {
  getProgress(propertyId: string): Promise<WizardProgress & { version: number; completedAt: string | null }>;
  saveNavigation(propertyId: string, lastActiveStep: number, expectedVersion?: number): Promise<WizardProgress & { version: number; completedAt: string | null }>;
  saveStep(input: SaveWizardStepInput): Promise<WizardProgress & { version: number; completedAt: string | null }>;
  complete(propertyId: string, expectedVersion?: number): Promise<void>;
  getAccessSummary(propertyId: string): Promise<InitializationAccessSummary>;
}
