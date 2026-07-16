# Recovery C — Trusted Employee Data Update and People Foundation

**Status:** Approved implementation design  
**Base:** Recovery 0, Recovery A, Recovery B, and the approved Suzhou real-data foundation  
**Active application roles:** Hotel L&D Manager and Department Training Responsible Person only

## 1. Outcome

Recovery C turns the existing employee/import foundation into one controlled hotel workflow:

```text
Private workbook
→ privacy-safe file inspection
→ field recognition
→ explicit department attribution
→ explicit position attribution
→ row-level issue resolution
→ zero-employee-write update preview
→ manager confirmation
→ one transactional employee update
→ authoritative People Center verification
→ immutable audit and guarded correction
```

Employees remain business records. No imported employee receives a Supabase Auth user, `user_accounts` record, membership, role assignment, or application workspace.

## 2. Approaches considered

### A. Extend the validated employee/import foundation — selected

Keep the existing property-scoped tables, private Storage bucket, repository boundary, commit audit, and reversal intent. Add only the missing per-batch attribution evidence, deterministic validation, strict state transitions, scoped employee directory, and complete UI workflow.

This preserves validated tenancy and RLS work while correcting the incomplete staging and commit behavior.

### B. Implement the workflow in the browser and use the existing commit RPC

Rejected. It would make the browser responsible for trusted matching and preview calculation, create drift between preview and commit, and weaken evidence and concurrency guarantees.

### C. Replace the import subsystem with a new service and schema

Rejected. The current schema already contains the correct core entities. Replacing it would duplicate audit concepts, increase migration risk, and discard validated foundations without product benefit.

## 3. User journey

The manager route remains `/import`, presented as **员工资料更新**.

1. **文件检查**
   - Upload `.xls`, `.xlsx`, or `.csv` to property-isolated private Storage.
   - Show filename, checksum reference, file size, detected sheets, selected employee sheet, header row, candidate rows, warnings, and excluded data categories.
   - File inspection and staging do not write `employees`.

2. **字段识别**
   - Show source column, recognized hotel field, required/optional state, transformation, and exclusion reason.
   - The manager confirms recognized fields before attribution.
   - Excluded column values are not copied into normalized or raw staging rows. The original private workbook remains the source evidence.

3. **部门归属确认**
   - Show every distinct source department label, affected row count, previous approved rule, exact-match suggestion, confidence basis, and selected official department or operational unit.
   - Suggestions never create or change the official tree.
   - The manager may map, defer, or explicitly exclude affected rows.

4. **职位归属确认**
   - Show all 113 source labels independently.
   - Map to an official position and optional family.
   - Never collapse source titles into generic roles without an explicit manager decision.

5. **数据问题处理**
   - Group issues by blocking and warning severity.
   - Allow row correction, approved exclusion, or return to attribution.
   - The two real-workbook rows with missing departments remain blocked until the manager explicitly assigns an official department or excludes each row.

6. **更新预览**
   - Deterministically classify each candidate as addition, update, unchanged, exclusion, blocked, or unresolved.
   - Show before/after differences for updates.
   - Show the employee status treatment chosen for this batch.
   - This step may update staging facts but writes no employee row.

7. **确认更新**
   - Require explicit acknowledgement of counts, exclusions, and status treatment.
   - Revalidate batch version, mappings, employee versions, and issues inside the database transaction.
   - Apply all employee and external-identifier changes atomically.
   - Re-read the completed batch and People Center facts.

8. **更新记录**
   - Show batch state, actor, timestamps, counts, exclusions, issues, mapping decisions, and audit evidence.
   - Completed batches support a guarded **撤销预览**. Unsafe reversal is refused with conflict evidence and a forward-correction path.

## 4. Real workbook boundary

The approved workbook remains outside Git and outside Vercel Preview.

Privacy-safe inspection evidence:

- sanitized filename: `Hotel-Training-Record-Master-Sheet-KIP-Suzhou.xls`
- size: 133,120 bytes
- checksum evidence: SHA-256 prefix `245bb3a4fe12`
- 3 visible sheets
- employee master: `Sheet1`, header row 3
- 196 employee candidates
- 194 structurally valid before attribution
- 2 rows missing department after normalization
- 0 duplicate employee numbers
- leading-zero employee numbers preserved
- 196 valid hire dates
- 196 valid probation/confirmation dates
- 30 department source labels
- 113 position source labels
- 13 excluded columns
- 0 employees written during inspection

Recognized fields:

- `Empid` → employee number
- `CName` → Chinese name
- `EName` → English name
- `Department` → department source label
- `Position` → position source label
- `Grade` → grade/band
- `JoinDate` → hire date
- `Probation` → probation/confirmation date

Excluded:

- Gender
- Mini Orientation
- Brand Training
- Management Orientation
- Hotel Orientation
- Orientation Test
- Initial Training
- Onboarding Checklist
- Leadership Journey
- Problem handling
- First Aid
- formula-derived CTC
- formula-derived GTC
- the separate CTC and GTC tracking sheets

Excluded values are not staged as employee data and never enter employee, KPI, course, training, attendance, feedback, or completion records.

## 5. Identity and status rules

- Employee number is text and the only default identity key.
- Leading zeros are preserved.
- Names never identify or merge employees by themselves.
- Approved external identifiers may detect a conflict but cannot silently merge records.
- Duplicate employee numbers inside the workbook block all duplicate rows.
- A property collision with a different external identifier blocks the row.
- Missing or invalid required dates block only when the hotel business rule requires that date.
- Workbook absence never deactivates an employee.
- Existing employee status is retained unless the staged row contains an explicitly recognized status and the manager confirms it.
- When a workbook has no status field, the manager must explicitly approve the batch rule: retain existing statuses and set additions active. Without that approval, additions remain blocked.
- `is_new_employee` is derived from the authoritative hire date and the current hotel `new_employee_days` rule during preview and rechecked during commit.

## 6. Data and security architecture

### 6.1 Reused foundations

- tenant/property isolation and hostname context
- active memberships and the two approved roles
- official department hierarchy and closure table
- operational units
- official positions and families
- `employees` and `employee_external_identifiers`
- private `property-import-files` Storage bucket
- import batches, sheets, field mappings, rows, issues, commits, and commit items
- repository/service boundary

### 6.2 Additive data requirements

One additive migration may introduce:

- per-batch source-label resolution evidence, preserving label, count, type, decision, target, actor, timestamp, and version;
- import activity events for state transitions and manager decisions;
- reversal preview token/expiry evidence;
- indexes required by scope, batch, identifier, and reversal queries.

No table represents training history, CTC/GTC completion, or employee application accounts.

### 6.3 Trusted processing boundary

- Page components call application services and repositories only.
- The server parses workbooks.
- Supabase-mode staging uses the authenticated manager’s access token and RLS, not a browser-exposed secret and not an unrestricted page query.
- Atomic validation, commit, and reversal use narrowly granted functions that start from `auth.uid()`, verify an active Hotel L&D Manager account, derive property scope from the batch, fix `search_path`, and reject stale versions.
- Audit and commit tables are append-only to authenticated clients.

### 6.4 Department employee directory

Department Training Responsible Persons do not receive base-table or workbook access.

A narrow server/RPC boundary returns only:

- employee number
- Chinese and English name
- official department
- optional operational unit
- position and optional family
- hire and probation/confirmation dates
- effective employment status
- new-employee indicator

Rows are limited to explicitly assigned branches and descendants only when the assignment says so. Import files, raw rows, issues, history, external identifiers, audit snapshots, and unrelated departments remain unavailable.

## 7. Commit guarantees

`commit_employee_import` is the only employee-master batch mutation path.

It must:

1. lock the batch;
2. verify manager account, property membership, exact role, and account status;
3. verify expected batch version and `ready_for_review`;
4. lock every matched employee and relevant external identifier;
5. rerun deterministic validation;
6. reject unresolved or blocked rows;
7. write additions and complete updates;
8. leave absent employees untouched;
9. write external identifiers without stealing an identifier from another employee;
10. append before/after audit evidence;
11. append the completed batch event;
12. update counts and status;
13. commit all changes or none.

Retries after a successful commit return the existing commit identity rather than creating a second commit.

## 8. Revert and forward correction

Reversal is not a generic undo button.

- A preview locks no data but produces a short-lived token tied to batch version, employee versions, external-identifier versions, and the current time.
- Reversal reacquires locks and recomputes conflicts.
- Inserted employees are deactivated rather than deleted.
- Updated employees restore the audited before snapshot.
- Identifiers created by the batch are deactivated; identifiers that predated the batch are restored rather than removed.
- Any later employee or identifier change refuses reversal.
- The UI then offers a forward-correction workflow based on a new employee update batch.

## 9. People Center

### Hotel L&D Manager

`/people` becomes the authoritative employee directory for the current property:

- total records and active/other status counts only when the source is available;
- search by employee number and Chinese/English name;
- official department, operational unit, position/family, and status filters;
- paginated repository query;
- profile drawer with authoritative refresh;
- source batch and last-updated evidence in business language;
- a persistent statement that training history is not connected;
- link to employee update history.

### Department Training Responsible Person

`/department/employees` shows:

- authorized scope and breadcrumb;
- only approved employee fields;
- server-enforced scoped search;
- no import/update/history action;
- no raw workbook, external identifier, global count, other-department data, or hotel configuration;
- truthful training-unavailable state.

## 10. Local review and Preview

- The real workbook is inspected only locally and never committed.
- Browser and Vercel review use a privacy-safe synthetic workbook/scenario with the same kinds of states, clearly labelled **受保护评审数据**.
- Preview never connects to Production Supabase and never silently presents review data as production.
- Real Supabase behavior is verified by a clean local reset, pgTAP, authenticated repository tests, and transaction tests.

## 11. Visual and interaction direction

Reuse Recovery B’s warm ivory, ink-blue structure, champagne emphasis, verified teal, actionable coral, and slate unavailable states.

- Keep one visible seven-step progress model.
- Prefer summaries and grouped exceptions over dense raw tables.
- Use drawers/dialogs for evidence and before/after detail.
- Every enabled control changes persisted staging state, navigates, or explains why it is unavailable.
- Maintain at least 44px interactive targets on mobile.
- Preserve visible focus, clear return paths, no horizontal overflow, and readable 11–14px operational text at normal zoom.

## 12. Acceptance boundary

Recovery C ends when the application can safely inspect, stage, attribute, validate, preview, commit, audit, and guard correction of employee master data, and both roles can read only their authorized employee directory.

Recovery C does not connect or simulate real training operations. No course, plan, session, attendance, feedback, QR, KPI actual, forecast, Training Operations Health, intervention, or AI recommendation is added.
