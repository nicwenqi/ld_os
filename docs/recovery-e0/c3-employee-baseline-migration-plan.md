# Recovery E0-C3 — Employee Baseline Migration Plan

## Scope and decision

C3 reuses the approved Recovery C/D0 employee-update pipeline. The only
database change required is an additive, overload-safe `commit_employee_import`
RPC signature that accepts the manager's baseline classification and stores it
inside the existing immutable import-approval evidence in the same transaction
as the employee update. It creates no new business table, no new fact type and
no training fact.

## Affected database surface

| Surface | C3 change | Unchanged guarantee |
| --- | --- | --- |
| `public.commit_employee_import` | Add an eight-argument controlled signature: batch, expected version, preview hash, explicit approval, baseline state, optional department, descendants flag and limitations. | Existing four-argument legacy signature remains non-executable for authenticated callers. |
| `public.import_commits.approval_evidence` | Add a `baseline` object during the existing transaction. | No column, RLS policy, direct DML grant or new table is added. |
| `import_activity_log` | Append baseline classification to the existing committed-import audit activity. | Existing preview, row-level before/after and Employee Fact Version evidence are retained. |
| `employees` / `employee_fact_versions` | No direct C3 schema or trigger change. | The existing controlled commit remains the sole employee write path and retains effective-date historical meaning. |

## Security and validation

The new signature continues to be `SECURITY DEFINER` only because the existing
commit procedure is a tightly bounded transaction. It keeps `search_path = ''`,
asserts an active Hotel L&D Manager through
`assert_active_property_import_manager`, accepts no browser property ID, and
retains no `PUBLIC`/`anon` execution grant.

It rejects an unknown state, a Full baseline with a scope or limitation, a
Restricted/Pilot Limited baseline without a stated limitation, and a
Pilot Limited baseline without an active department in the current
property. A supplied scope never changes employee eligibility or a future
department role; it is only a truthful declaration of the committed baseline's
ready boundary.

## Rollback

The migration is additive: rollback is a forward migration that revokes the
eight-argument signature and restores the previous controlled signature. No
employee row needs database rollback because migration rehearsal uses only
local synthetic test transactions. A committed employee baseline remains
correctable only through the established preview/audit/revert or forward-
correction path, never through direct DML.

## Explicit non-scope

No Course, Requirement, Plan, Session, Attendance, Completion, Feedback, KPI,
Forecast, Risk, Health, AI or automation capability is added. Production,
Production Supabase and real hotel workbooks are excluded.
