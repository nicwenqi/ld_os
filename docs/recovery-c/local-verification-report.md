# Recovery C local verification report

Verification date: 2026-07-18  
Branch: `codex/recovery-c`

## Scope and safety boundary

- All database, Storage, workbook and browser work in this report used the local Supabase stack or privacy-safe local-review fixtures.
- The approved real workbook stayed local and outside Git, Vercel and Supabase Production.
- No Production migration was applied; no Production employee, account, property, department, position or scope was created or changed.
- Recovery D data and behavior were not implemented.

## Local database and security verification

| Verification | Result |
| --- | --- |
| Clean local Supabase reset from migrations and seed | Passed |
| pgTAP database suite | 17 files, 478 tests, all passed |
| Recovery C Storage API integration | 3/3 passed on each of two runs |
| Supabase security advisor | No issues found |
| Supabase performance advisor | No errors attributable to Recovery C; existing informational and warning findings retained for later reviewed work |
| Clean-seed employee and import state | 0 employees, 0 import batches |

The pgTAP suite verifies property isolation, actor-scoped staging, manager-only preview and commit, zero-write preview, explicit-confirmation commit, field and attribution decisions, blocked rows, status treatment, absent-employee preservation, audit history, guarded reversal, department-scope employee reads, private Storage paths and RLS/RPC authorization. The transactional commit test also proves that importing an employee creates neither an Auth user nor a backend `user_accounts` or role-assignment record.

## Application verification

| Verification | Result |
| --- | --- |
| ESLint | Passed with 0 errors; 3 pre-existing `next/image` advisory warnings |
| Application tests | 196/196 passed |
| Production build | Passed |
| Rendered HTML test | 1/1 passed |
| Focused Recovery C UI/service/route tests | Passed |

The lint boundary excludes generated `.vercel` and `dist` output so source lint results are not polluted by generated bundles. The production-wiring test follows the refactored controlled file-input component while retaining the server-authorized property-context assertion.

## Real workbook aggregate inspection

The approved legacy workbook was inspected locally through the trusted parser with aggregate-only evidence:

- 196 employee candidate rows; 194 structurally valid before attribution.
- 2 rows blocked because department is missing after normalization.
- 0 missing employee numbers, 0 missing positions and 0 duplicate employee numbers.
- Leading-zero employee numbers remain text.
- 196 valid hire dates and 196 valid probation/confirmation dates; no invalid or ambiguous dates.
- 30 department source labels and 113 position source labels require manager-reviewed attribution.
- 13 excluded columns: 2 formula-derived and 11 training-history or sensitive columns.
- CTC/GTC tracking sheets and all training-history fields remain excluded.
- 0 employee rows, training records or CTC/GTC records were written during inspection.

The committed privacy-safe evidence is in `docs/recovery-c/real-workbook-inspection.md`; it contains no employee name, employee number, row values or full checksum.

## Browser defect found during local review

The local-review Department Training Responsible Person directory initially returned a hotel-wide fixture rather than the authorized branch. A failing test reproduced the leak. The fix introduced an actor-scoped server boundary that derives the department branch and descendants from the authenticated session and ignores browser-supplied scope. Browser re-verification showed only the single authorized synthetic employee; the manager-only employee-update route returned access denied.

## Transaction and rollback conclusions

- Inspection and decision saves do not write `employees`.
- Preview is computed server-side and remains zero-write.
- Commit requires a current authoritative batch version, saved decisions, zero blocking/unresolved rows and explicit manager acknowledgement.
- Commit applies additions and updates atomically, retains absent employees under the approved default status treatment, writes audit evidence and rereads authoritative state.
- Revert begins with a guarded preview, detects later employee changes and blocks conflicting reversal rather than overwriting newer truth.
- A forward-correction through a later workbook remains available when reversal would be unsafe or operationally inappropriate.

## Proposed additive migrations (local and Preview only)

- `20260716134322_recovery_c_employee_update_integrity.sql`
- `20260716143542_recovery_c_actor_scoped_import_staging.sql`
- `20260716144503_recovery_c_transaction_integrity_followup.sql`
- `20260716151459_recovery_c_remaining_import_bypasses.sql`
- `20260716152053_recovery_c_private_workbook_cleanup.sql`
- `20260716155714_recovery_c_workbook_exclusion_alignment.sql`

These migrations remain unapplied to Production pending separate explicit approval.
