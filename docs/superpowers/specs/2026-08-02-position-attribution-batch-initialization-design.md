# Position Attribution Batch Initialization Design

## Purpose

Make the first hotel employee-baseline import workable when a workbook contains dozens or hundreds of distinct source-position labels. This feature accelerates only **职位归属确认**. It does not write employees, Employee Fact Versions, training facts, or completion facts.

## Existing boundary retained

`import_source_label_resolutions` remains the current-batch attribution evidence and the existing zero-write preview reads it. `commit_employee_import` remains the sole operation that can create or update employee master facts and Employee Fact Versions after explicit manager confirmation.

```text
staged source-position labels
→ manager batch-decision preview
→ explicit confirmation
→ source-label resolution evidence
→ existing zero-write employee preview
→ existing final employee confirmation and commit
```

## Manager experience

The Position Attribution step shows all unresolved source-position labels, their affected employee-row counts, and a total. A manager selects labels and chooses one controlled path:

1. **创建正式职位** — preview one new official position per selected source label, then explicitly confirm creation and mappings.
2. **关联至已有职位** — select one official position and explicitly map all selected labels to it.
3. **单项特殊处理** — retain existing label-by-label mapping, exclusion, and defer controls.

No semantic recommendation or automatic matching is introduced.

## Official-position creation defaults

Each selected source label creates one active current-property position. The label is preserved as the initial display name; a deterministic server-generated code is used; position family and department applicability stay unset. The manager can later refine the official position through existing organization administration.

When a same-name active position exists, the preview requires an explicit map-to-existing or create-distinct choice. It never silently maps. A generated-code collision blocks only that label.

## Decision and audit evidence

The business-facing states are `pending`, `create`, `map`, `exclude`, and `defer`. Persisted source-label evidence uses existing durable states: `create` and `map` produce `mapped` records with a position target; `exclude` and `defer` produce existing `excluded` and `deferred` records.

Confirmation writes both a detail resolution for every source label and one append-only `import_activity_events` summary. The latter identifies the action, selected-label count, affected-row count, created or selected targets, actor, and resulting batch version. Decisions are never represented only by aggregate JSON.

## Security and concurrency

- Only an active Hotel L&D Manager for the batch property can preview or confirm.
- Tenant, property, batch, labels, and target position are server-derived and scope-checked.
- Department Training Responsible Persons and Platform Admins are denied.
- Confirmation locks the batch, checks its expected version, applies all decisions atomically, and increments the batch version once.
- Preview is version-bound and server-evidenced; stale or altered selections cannot be confirmed.
- A narrow fixed-search-path `SECURITY DEFINER` RPC is used only for the atomic protected mutation. It has explicit grants and no PUBLIC execution.

## Non-goals

- No employee write before the existing final import confirmation.
- No Employee Fact Version mutation outside the existing commit path.
- No change to D0–D4 facts, role model, or tenant isolation.
- No automatic position family, department, account, or training fact creation.
