# Recovery E0-C — Pilot Initialization Design

**Status:** Approved design direction with final refinements; implementation not started  
**Current gate:** `No Go` until the implementation plan and any required security migration are separately approved  
**Fact scope:** Reuse D0–D4 only; introduce no D5 or new training-business fact semantics  
**Data boundary:** No Production connection, migration, employee import, account mutation, or training fact is authorized by this document

## 1. Product decision

E0-C is the SaaS product flow for initializing the first Pilot property. It is not an enterprise procurement, external-owner, or document-signing workflow.

The product journey is:

```text
Super Admin provisions the property foundation
→ Super Admin assigns the first Hotel L&D Manager
→ Hotel L&D Manager completes hotel activation and authorized scope
→ Hotel L&D Manager uploads the employee baseline
→ System produces a zero-write preview
→ Hotel L&D Manager approves the exact preview
→ System commits Employee Fact Versions
→ Hotel L&D Manager creates the first Requirement
→ Hotel team delivers one governed training
→ Authorized operator records Attendance
→ Authorized manager verifies Completion
```

Each stage uses the existing D0–D4 fact boundaries. E0-C joins those capabilities into one controlled Pilot journey; it does not create a parallel data model or reinterpret an existing fact.

The previous external governance-owner and signature-matrix approach is superseded. Git history may retain those documents as historical artifacts, but they are not E0-C product gates.

## 2. Role and identity model

### 2.1 Super Admin

Super Admin is an internal platform-provisioning role.

It may:

- create the tenant/property foundation required for one Pilot property;
- establish minimum technical property identity and hostname context;
- provision and assign the first Hotel L&D Manager;
- verify that the property can be handed off to the manager;
- view only the provisioning status and redacted technical evidence needed for those actions.

It may not, by platform authority alone:

- edit hotel training business rules after handoff;
- maintain the hotel department hierarchy, positions, or employee data;
- upload or inspect employee workbooks;
- create or alter Course, Requirement, Plan, Session, Attendance, or Completion facts;
- view hotel employee or training-business data;
- impersonate the Hotel L&D Manager;
- enter the hotel operations workspace.

If the same person also needs hotel business authority, that person must separately receive an active property membership, active backend account, and an approved hotel role through the normal hotel account process. Platform membership is never treated as hotel authorization.

### 2.2 Hotel L&D Manager

The Hotel L&D Manager is the primary hotel administrator and the accountable business owner for the property.

The manager:

- confirms hotel identity and business rules;
- maintains the official organization and position foundation;
- appoints Department Training Responsible Persons and grants explicit department scopes;
- owns the employee-baseline preview and commit decision;
- creates and governs the first Requirement;
- owns or delegates the first Session within approved department scope;
- reviews Attendance exceptions;
- verifies Completion through the D4 evidence path;
- decides whether the Pilot is ready, conditionally ready, or blocked.

No Super Admin approval substitutes for the Hotel L&D Manager’s business decision.

### 2.3 Department Training Responsible Person

This remains the only department-scoped authenticated hotel role. It may operate only inside explicit active department branches and descendant rules. It cannot widen its own scope, manage the employee workbook, change hotel settings, or access unrelated departments.

### 2.4 Trainer

Trainer is an operational resource identity used for delivery readiness and immutable Session Revision context. Trainer is not automatically an authenticated hotel administrator and gains no employee or hotel-wide access from being named as a trainer.

### 2.5 Employee

Employee remains a managed business record and may later use constrained QR/token experiences. Employee has no hotel administration login, workspace, backend account, or role.

### 2.6 Authenticated-workspace invariant

The hotel administration application still has only two authenticated hotel workspace roles:

1. Hotel L&D Manager;
2. Department Training Responsible Person.

Super Admin operates a separate internal provisioning plane. Trainer and Employee are business identities, not hotel administration roles.

## 3. Two-plane authorization model

### Platform provisioning plane

The platform plane answers only:

- Does the platform operator have an active Super Admin membership?
- May this operator provision this new property foundation?
- Was the property and first-manager handoff performed atomically and audited?

It does not answer whether the operator may manage hotel business data.

### Hotel business plane

The hotel plane continues to require:

```text
Active account
+ active tenant/property membership
+ active hotel role
+ property context
+ department scope and descendant rule where applicable
```

Every employee or training-business read and mutation must use the hotel plane. A Super Admin membership must neither satisfy nor bypass these checks.

### Current implementation conflict

The existing D0–D4 employee and training-fact helpers already use active hotel-account and hotel-role assertions. However, earlier foundation helpers and policies still include `platform_admin` in parts of property settings, organization, profile, account, and property-management access.

That legacy breadth conflicts with this approved design. Hiding platform navigation is insufficient. Before E0-C implementation may expose a Super Admin provisioning flow, a separately reviewed additive security migration must:

- isolate platform provisioning assertions from hotel business-management assertions;
- remove platform membership as an implicit hotel-business authorization;
- route provisioning mutations through a narrow server RPC;
- preserve RLS, actor identity, transactionality, and audit;
- leave D0–D4 fact semantics unchanged.

No such migration is created by this design checkpoint.

## 4. Pilot property initialization

### Stage C1 — Platform provisioning

Super Admin supplies only the minimum property foundation:

- tenant/property identity;
- Chinese and English hotel names;
- property code;
- timezone and language;
- primary hostname context;
- initial property status;
- first Hotel L&D Manager identity.

The system must show a confirmation preview before mutation. Property foundation and initial manager assignment must use server-side authorization and auditable operations. A partial property without a usable manager must not be presented as successfully handed off.

The Super Admin does not configure employee data, training business rules, organization content, or training facts.

### Stage C2 — Manager handoff and finite activation

After hotel-branded login, the Hotel L&D Manager completes the existing finite activation:

1. confirm hotel identity and business rules;
2. establish the official department structure and relevant operational units;
3. confirm positions and position families needed by the Pilot cohort;
4. assign any Department Training Responsible Person and explicit scope;
5. review readiness and enter the employee-baseline workflow.

Activation remains escapable and finite. After handoff, maintenance belongs in normal administration pages.

### Stage C3 — Employee baseline

The manager uses **员工资料更新**:

```text
private workbook upload
→ file inspection
→ field recognition
→ department attribution
→ position attribution
→ issue handling
→ zero-write before/after preview
→ explicit approval of preview version/hash
→ transactional commit
→ authoritative re-read
→ People Center verification
```

The workflow preserves employee numbers as text, excludes training history and CTC/GTC completion facts, creates no Auth user, and never guesses identity, department, position, date, or status.

## 5. Employee baseline states

Baseline classification describes the coverage trusted for Pilot operation. It is not an employee status and does not replace row-level validation.

| State | Meaning | Allowed Pilot scope | Prohibited claims |
|---|---|---|---|
| **Full** | The expected current property employee population is committed; all material exceptions are resolved or explicitly excluded with evidence. | The approved Pilot may use any clean, eligible property cohort. | No claim beyond the committed as-of date or excluded evidence. |
| **Restricted** | The baseline is broadly usable, but documented limitations remain outside or immaterial to the selected Pilot cohort. The limitations and exclusions are visible. | Only cohorts proven unaffected by the stated limitations. | No use of excluded/unresolved records; no unqualified property-wide completeness claim. |
| **Pilot Limited** | Only a named department branch or cohort has a complete, trustworthy baseline. The rest of the property is explicitly outside the Pilot boundary. | Only the named cohort and its approved department scope. | No hotel-wide denominator, completeness, compliance, KPI, Health, Forecast, or Risk conclusion. |

`No Go` or `Blocked` is a gate outcome, not a fourth baseline state.

Perfect property-wide data is not required to start a limited Pilot. Regardless of baseline state, every employee included in the Pilot must have:

- a resolved employee identity and external identifier;
- an effective Employee Fact Version for the relevant event date;
- a resolved official department;
- the position and employee-status evidence required by the Requirement rule;
- no unresolved conflict that could change eligibility or authorized scope.

Missing evidence stays missing. It is not converted to a default, zero, inactive status, or `Not Applicable`.

## 6. First governed training loop

The recommended first Pilot case remains **消防安全年度培训**, but the hint does not create a Course or Requirement.

### Stage C4 — Requirement

The Hotel L&D Manager confirms:

- the formal Requirement identity and effective Requirement Version;
- its Completion Definition;
- its Accepted Learning Method;
- the published Course Version when the method is course-based;
- the effective Eligibility Rule Set;
- the point-in-time Eligibility Evaluation for the selected cohort.

Eligibility remains three-state and is not an assignment. An intended participant with `Unable to Determine` cannot enter the controlled proof cohort until the missing evidence is resolved.

### Stage C5 — Plan, Session, and delivery

The manager or authorized department role creates:

- an approved Training Plan Version and Plan Item;
- an immutable published Session Revision;
- a responsible owner;
- trainer and venue/resource readiness;
- a Participant Snapshot referencing Employee Fact Versions.

Publishing a Session is not delivery. Delivery is demonstrated only by the governed D3 attendance process.

### Stage C6 — Attendance

Authorized hotel users open the register, record QR observations and/or manual witness evidence, reconcile conflicts, make explicit determinations, and close the register.

QR observation is not `Present`. Attendance is not Completion.

### Stage C7 — Completion verification

An authorized manager reviews D4 Completion Evidence against the exact:

- Requirement Version;
- Accepted Learning Method;
- Course Version where applicable;
- Employee Fact Version;
- Session Revision and attendance source where attendance-derived.

The system creates no completion without evidence and no KPI, reminder, task, risk, or health result from the completion.

## 7. Pilot success criteria

The Pilot succeeds only when all six conditions are proven from authoritative, scoped facts:

1. **One property initialized**  
   The property has a valid hostname context, finite activation status, official organization foundation, and at least one active Hotel L&D Manager.

2. **Employee baseline committed**  
   The exact approved preview version/hash is committed, audited, re-read, and classified as `Full`, `Restricted`, or `Pilot Limited`.

3. **One Requirement created**  
   One Requirement Version is effective with an accepted method and a deterministic Eligibility Evaluation for the Pilot cohort.

4. **One training delivered**  
   An immutable Session Revision and Participant Snapshot exist, the scheduled delivery occurred, and D3 evidence—not publication alone—supports that delivery.

5. **Attendance recorded**  
   The register contains explicit determinations, conflicts are resolved or represented according to D3, and the register is closed through an authorized action.

6. **Completion verified**  
   At least one reviewed Completion Record traces through valid Completion Evidence to the exact Requirement Version, accepted method, Employee Fact Version, and source Session Revision where applicable.

Passing these criteria does not claim training effectiveness, hotel compliance, KPI achievement, Health, Forecast, or Risk.

## 8. Review stops and failure behavior

E0-C implementation and execution remain sequential:

| Review stop | Evidence required | Stop condition |
|---|---|---|
| **C0 — Security boundary** | Platform/hotel authorization separation, migration impact, RLS/RPC/audit tests | Any platform role can read or mutate hotel business data without a separate hotel role |
| **C1 — Property handoff** | Property preview, atomic creation result, first-manager assignment, hotel login | Partial property, unusable manager, hostname ambiguity, or missing audit |
| **C2 — Activation and scope** | Settings, official organization, role/scope direct-route denial | Scope ambiguity, self-widening, inactive account, or unrelated-department access |
| **C3 — Employee baseline** | Zero-write preview, manager approval, commit audit, authoritative re-read, classification | Stale preview, unresolved Pilot employee, guessed mapping, or unclassified baseline |
| **C4 — Requirement readiness** | Effective Requirement Version, accepted method, three-state eligibility evidence | Intended participant is `Unable to Determine` or method/version is invalid |
| **C5 — Delivery and attendance** | Immutable Session Revision, snapshot, readiness, closed register | Publication used as delivery, unresolved evidence conflict, or unauthorized action |
| **C6 — Completion and Pilot close** | Reviewed completion lineage and redacted Pilot report | Attendance used as automatic completion or lineage cannot be traced |

Failure stops the current stage. It does not authorize synthetic repair, direct DML, broader scope, or a later-stage fact.

## 9. Interaction and evidence contract

Every enabled action must perform a real, authorized state transition or explain why it is unavailable. No toast-only success and no automatic cross-stage transitions are allowed.

Each stage must preserve:

- actor;
- time;
- property and authorized scope;
- action;
- source version/hash or immutable fact reference;
- before/after or transition evidence where applicable;
- failure or conflict reason;
- authoritative re-read result.

Approvals are product decisions recorded by the authorized user at the relevant transition. E0-C does not require external owner signatures or enterprise governance forms.

## 10. Migration impact

No migration is created at this checkpoint.

Implementation planning must assume one separately approved additive security/readiness migration may be required to:

- create a narrow, audited platform-provisioning RPC;
- ensure property and initial-manager creation are atomic or safely compensating;
- separate platform provisioning from hotel business-management helpers and policies;
- prevent direct platform DML from bypassing provisioning;
- persist a baseline classification and its approved scope/evidence without changing Employee Fact Version semantics;
- record redacted Pilot provisioning/readiness audit events.

The migration must not alter the meaning or immutability of D0 Employee Fact Version, D1 Requirement Version, D2 Session Revision/Participant Snapshot, D3 Attendance Facts, or D4 Completion Evidence.

If the implementation audit proves the existing schema can meet every requirement without a migration, the migration proposal is withdrawn. Convenience is not sufficient evidence to skip the security gate.

## 11. Explicit non-scope

E0-C does not introduce:

- D5;
- KPI;
- Forecast;
- AI;
- Feedback;
- automation;
- Health;
- Risk;
- reminders or notifications;
- employee login or employee workspace;
- a generic multi-hotel business console;
- automatic Requirement, Session, Attendance, or Completion creation.

Every real fact remains a deliberate, authorized human action through the existing D0–D4 workflow.

## 12. Design acceptance

This design is accepted when:

- Super Admin is demonstrably limited to platform provisioning;
- Hotel L&D Manager is the primary property administrator and business owner;
- hotel workspaces remain limited to the two approved authenticated hotel roles;
- `Full`, `Restricted`, and `Pilot Limited` are explicit, auditable baseline states;
- imperfect property-wide data can support a bounded Pilot without weakening row-level trust;
- the six Pilot success criteria preserve the D0–D4 lineage;
- no platform authority silently becomes hotel business authority;
- no fake facts, automatic cross-stage transitions, or analytics are introduced;
- implementation cannot cross a failed Review Stop;
- Production and all real data remain untouched until separately approved.
