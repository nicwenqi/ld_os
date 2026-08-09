import type { NeonQueryable } from "../../lib/neon/actor-context.ts";
import type { InitializationRepository, SaveWizardStepInput } from "../contracts/initialization-repository.ts";
import type { WizardProgress } from "../../services/initialization-wizard-service.ts";

type Progress = WizardProgress & { version: number; completedAt: string | null };

export function createNeonInitializationRepository(database: NeonQueryable, hostname: string): InitializationRepository {
  return {
    async getProgress() {
      return scalar<Progress>(await database.query(`select public.get_neon_initialization_progress($1::text) as value`, [hostname]));
    },
    async saveNavigation(_propertyId, lastActiveStep, expectedVersion = 0) {
      return scalar<Progress>(await database.query(`select public.save_neon_initialization_navigation($1::text,$2::smallint,$3::bigint) as value`, [hostname, lastActiveStep, expectedVersion]));
    },
    async saveStep(input: SaveWizardStepInput) {
      return scalar<Progress>(await database.query(`select public.save_neon_initialization_step($1::text,$2::text,$3::smallint,$4::boolean,$5::text,$6::text,$7::bigint) as value`, [hostname, input.stepKey, input.lastActiveStep, input.explicitlyConfirmed ?? false, input.warning ?? null, input.blockingReason ?? null, input.expectedVersion ?? 0]));
    },
    async complete(_propertyId, expectedVersion = 0) {
      await database.query(`select public.complete_neon_initialization($1::text,$2::bigint)`, [hostname, expectedVersion]);
    },
    async getAccessSummary() {
      return scalar(await database.query(`select public.read_neon_initialization_access_summary($1::text) as value`, [hostname]));
    },
  };
}

function scalar<T>(result: { rows: Array<{ value?: T }> }): T {
  const value = result.rows[0]?.value;
  if (value === undefined) throw new Error("NEON_INITIALIZATION_EMPTY_RESPONSE");
  return value;
}
