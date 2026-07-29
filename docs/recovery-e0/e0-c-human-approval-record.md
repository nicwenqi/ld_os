# Recovery E0-C — Human Approval Record

> **Purpose:** Human-completed decision record for E0-C Pilot/property initialization and real employee-baseline preparation. It is not an execution log, Production Review Approval, migration authorization, or employee-import approval.

## A. Approval metadata

| Field | Value to be completed by human owner |
| --- | --- |
| 项目 / Project | `Hotel L&D OS` |
| 环境 / Environment | `[Pilot property context — do not enter credentials or connection strings]` |
| 阶段 / Recovery phase | `Recovery E0-C — Pilot/property initialization and employee-baseline preparation` |
| 当前准入状态 / Current entry state | `No Go until every required owner and decision below is completed` |
| 批准日期 / Approval date | `[YYYY-MM-DD]` |
| 文档版本 / Document version | `E0-C approval record v1.0` |
| 关联决策锁 / Related decision lock | `docs/recovery-e0/e0-c-entry-decision-lock.md` |
| 关联发布证据 / Related release evidence | `[E0-A release manifest reference]`; `[E0-B rehearsal evidence reference]` |
| 审批记录编号 / Approval record ID | `[human-managed identifier]` |

## B. Required named owners

All six roles require a real accountable person before E0-C can move from `No Go`. A role title, shared inbox, or unverified local fixture is not a named owner.

| Role | Name | Organization | Responsibility | Approval status | Date | Signature or approval reference |
| --- | --- | --- | --- | --- | --- | --- |
| Database Owner | `[full name]` | `[organization]` | Owns the E0-B lint finding, local remediation classification, migration-history governance, and any future separately approved schema decision. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |
| Release Owner | `[full name]` | `[organization]` | Owns release-manifest integrity, compatible build identification, and the boundary between local rehearsal and any later approved release. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |
| Evidence Reviewer | `[full name]` | `[organization]` | Reviews redacted E0 evidence, verifies that claimed evidence matches performed work, and rejects missing or misleading evidence. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |
| Pilot Property Owner | `[full name]` | `[hotel / operating organization]` | Authorizes the selected hotel property, limited Pilot scope, hotel operational participation, and any later Pilot go/no-go decision. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |
| Hotel L&D Manager | `[full name]` | `[hotel / operating organization]` | Approves baseline preview review, data-issue disposition, eligibility/business-rule decisions, and future learning-operation decisions within approved scope. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |
| Data Owner | `[full name]` | `[hotel / operating organization]` | Confirms workbook provenance, privacy handling, permitted fields, data-quality disposition, and retention/redaction handling. | `Pending / Approved / Declined` | `[YYYY-MM-DD]` | `[signature or controlled approval reference]` |

### B.1 Existing lint warning decision

| Field | Human-completed value |
| --- | --- |
| Finding | `app_private.prepare_employee_import_preview_base` has an existing text-to-`public.import_batch_status` local lint warning. |
| Database Owner acceptance | `[Name, date, and explicit ownership statement]` |
| Risk classification | `[blocking / controlled exception / remediation required]` |
| Approved next action | `[local-only reproduction, test, remediation proposal, or documented exception]` |
| Evidence reference | `[redacted local evidence only]` |
| Does this record authorize a migration? | `No. Any migration needs separate explicit approval.` |

## C. Pilot scope approval

This section defines a proposed limited scope. It does not create a Course, Requirement, Plan, Session, Attendance, or Completion fact.

| Field | Human-completed value |
| --- | --- |
| Property | `[official property name and approved property-context reference]` |
| Department branch | `[official department branch]` |
| Descendant scope rule | `[included / excluded; explain the authorized rule]` |
| Cohort definition | `[limited cohort, inclusion basis, estimated count, exclusions]` |
| Department responsible person | `[name and existing authorized account/role/scope reference, if delegated]` |
| Pilot operational purpose | `[business purpose only; no KPI, health, or forecast claim]` |
| Candidate first business case | `消防安全年度培训` or `[other approved candidate]` |
| Business-case status | `Candidate only — not an approved or Effective Requirement Version` |
| Property Owner approval | `[name, date, signature/reference]` |
| Hotel L&D Manager approval | `[name, date, signature/reference]` |

## D. Employee baseline authorization

All employee data remains managed business data. This authorization must preserve the Recovery C workflow and must not provision employee backend accounts.

| Field | Human-completed value |
| --- | --- |
| Workbook source | `[source system/owner, as-of date, and authorized handoff reference; do not embed workbook or personal data]` |
| Authorization statement | `[Data Owner and Hotel L&D Manager statement authorizing only private inspection and zero-write preview]` |
| Privacy handling | `[private Storage path/process, permitted reviewers, retention/deletion approach, redaction rule]` |
| Field boundary | `Employee master fields only. Exclude training history, CTC/GTC completion records, and formula-derived training fields.` |
| Preview approval | `[review-version/hash, named reviewer, date, and zero-write preview approval reference]` |
| Baseline classification | `Full / Restricted / Cannot start` |
| Restricted-baseline condition | `[if Restricted: clean approved cohort, excluded unresolved rows, prohibited hotel-wide conclusions, named approver]` |
| Import approval boundary | `This record authorizes no import commit. A later explicit approval must reference the exact reviewed version/hash and approved preview.` |
| Employee account boundary | `No imported employee receives an Auth identity or backend account automatically.` |
| Data Owner approval | `[name, date, signature/reference]` |
| Hotel L&D Manager approval | `[name, date, signature/reference]` |

## E. Explicit non-approval statement

Signing or completing this record **does not authorize** any of the following:

- Production connection;
- migration execution;
- employee import;
- Course creation;
- Requirement creation;
- Session creation;
- Attendance creation; or
- Completion creation.

It also does not authorize a deployment, DNS or environment-variable change, account creation, real employee-data mutation, KPI, Health, Forecast, Risk, Feedback, AI capability, or any D5 work.

No approval in this record changes D0–D4 semantics. In particular, eligibility is not assignment, QR observation is not attendance determination, attendance is not completion, and missing evidence is not a negative or completed fact.

## F. Final decision

Select exactly one outcome after all required owner entries and evidence references have been reviewed.

- [ ] **Approved for E0-C execution preparation**
  - This authorizes only the bounded, non-Production preparation stated in this record.
  - It does not authorize any item listed in Section E.
  - Approval authority: `[name]`

    Date: `[YYYY-MM-DD]`

    Signature / controlled approval reference: `[reference]`

- [ ] **Remain No Go**
  - Missing, declined, conflicting, expired, or insufficient approval/evidence must keep E0-C closed.
  - Blocking reason(s): `[list each unresolved owner, evidence gap, or scope conflict]`
  - Recorded by: `[name]`

    Date: `[YYYY-MM-DD]`

## Record handling

- Retain only redacted references in the repository; do not place credentials, raw workbooks, employee details, access tokens, browser sessions, or private Storage URLs in this document.
- Human approvals must be recorded through the organization’s approved signing or approval system; this Markdown template is an index to that evidence, not a substitute for it.
- Any later data, schema, traffic, or business-fact action requires its own explicitly scoped approval and audit evidence.
