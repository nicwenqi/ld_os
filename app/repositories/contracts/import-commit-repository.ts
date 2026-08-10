/** E5D server-only commit and guarded compensating revert boundary. */

export type ImportCommitResult = {
  commitId: string;
  batchId: string;
  status: "committed" | "reverted";
  version: number;
  previewHash?: string;
  batchVersion?: number;
  decisionVersion?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  excluded?: number;
  destructiveDelete?: false;
};

export type ImportRevertPreview = {
  safe: boolean;
  conflicts: number;
  strategy: "compensating_employee_mutation_no_delete";
  commitVersion: number;
  dependencyChecks: {
    currentEmployeeVersions: "pass" | "conflict";
    destructiveDelete: "never";
  };
};

export interface ImportCommitRepository {
  commit(input: {
    batchId: string;
    expectedBatchVersion: number;
    expectedDecisionVersion: number;
    previewHash: string;
    confirmed: true;
  }): Promise<ImportCommitResult>;
  previewRevert(batchId: string): Promise<ImportRevertPreview>;
  revert(input: { batchId: string; expectedCommitVersion: number; confirmed: true }): Promise<ImportCommitResult>;
}
