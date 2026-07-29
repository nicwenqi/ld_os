# Recovery E0-C — Property Initialization Design

**Status:** Final design approved subject to this scope lock; implementation not started
**Current gate:** `No Go` until the C0 security boundary and its migration proposal are separately approved
**Fact scope:** Property activation and the existing D0 employee-baseline workflow only
**Data boundary:** No Production connection, migration, employee import, account mutation, or training fact is authorized by this document

## 1. Final scope decision

E0-C initializes one Pilot property. It ends when the hotel has a usable property context, an active Hotel L&D Manager, a confirmed organization and department authorization foundation, and a committed employee baseline.

E0-C does not execute training.

The final E0-C journey is:

```text
Super Admin creates Property container
→ Super Admin creates initial Hotel L&D Manager invitation
→ Hotel L&D Manager accepts invitation and logs in
→ Hotel L&D Manager confirms hotel business profile and rules
→ Hotel L&D Manager confirms organization and department scope
→ Hotel L&D Manager previews and commits employee baseline
→ E0-C initialization review
```

The later training journey is a separate **Pilot Training Cycle**:

```text
Requirement
→ Plan
→ Session
→ Attendance
→ Completion
```

That cycle reuses the accepted D1–D4 capabilities. It is not part of E0-C implementation or acceptance.

## 2. Role boundaries

### 2.1 Super Admin

Super Admin is an internal platform-provisioning role.

It may only:

- create the tenant/property container required for the first Pilot property;
- establish the minimum technical property context needed for handoff;
- create the initial Hotel L&D Manager invitation;
- confirm that the invitation and property context are available for manager login;
- view redacted provisioning status for those operations.

The Property container may contain provisional technical values required by the existing schema, such as property code, preliminary names, hostname context, timezone, and language. These values are not treated as manager-confirmed hotel business data.

Super Admin may not, through platform authority:

- confirm or maintain the hotel’s business profile or training rules;
- create, edit, or approve departments, operational units, positions, or position families;
- appoint Department Training Responsible Persons or define their scopes;
- upload, inspect, preview, or commit employee data;
- access People Center;
- create or alter Course, Requirement, Plan, Session, Attendance, or Completion facts;
- enter a hotel operations workspace;
- impersonate the Hotel L&D Manager.

If the same person also requires hotel business authority, that person must separately receive an active property membership, active hotel backend account, and approved hotel role. Platform membership alone never grants hotel access.

### 2.2 Hotel L&D Manager

The Hotel L&D Manager is the primary hotel administrator and business owner.

The manager:

- accepts the initial invitation and completes the required password change;
- confirms the Chinese and English hotel identity, brand, location, timezone, language, and business rules;
- maintains the official department hierarchy and operational units;
- maintains the positions and position families required for reliable employee attribution;
- appoints Department Training Responsible Persons;
- grants explicit official department branches and descendant rules;
- owns employee-workbook inspection, mapping, zero-write preview, approval, and commit;
- confirms whether E0-C initialization is ready.

A Super Admin handoff cannot substitute for the manager’s business confirmation.

### 2.3 Department Training Responsible Person

This remains the only department-scoped authenticated hotel role. It receives one or more explicit official department branches and descendant rules from the Hotel L&D Manager.

It cannot:

- widen its own scope;
- configure hotel business rules or global organization;
- administer accounts or roles;
- access raw employee workbooks or employee import controls;
- access unrelated departments.

Its scope must be ready before E0-C can pass when the Pilot intends to use a department role. A manager-only Pilot may pass with no department-role account, provided the organization foundation is ready and the absence is explicitly represented.

### 2.4 Trainer and Employee

Trainer is an operational resource identity, not an automatically authenticated hotel administrator.

Employee is a managed business record and constrained QR/token participant. Employee has no administration login, workspace, backend account, or role.

### 2.5 Authenticated-workspace invariant

The hotel administration application continues to expose only:

1. Hotel L&D Manager;
2. Department Training Responsible Person.

Super Admin operates a separate internal provisioning plane. Trainer and Employee are not hotel administration roles.

## 3. Platform plane versus hotel business plane

### Platform provisioning plane

The platform plane answers:

- Is this an active Super Admin?
- May this operator create a new property container?
- May this operator issue the initial manager invitation?
- Was the handoff completed without a partial or orphaned identity?

It does not answer whether the operator may manage hotel business data.

### Hotel business plane

Every hotel-business operation continues to require:

```text
Active account
+ active tenant/property membership
+ active hotel role
+ hostname-resolved property context
+ department scope and descendant rule when applicable
```

Employee and training-business reads and mutations always use this hotel plane.

### Current implementation conflict

D0–D4 employee and training-fact helpers already require active hotel-account and hotel-role assertions. Earlier foundation helpers and RLS policies still include `platform_admin` in parts of property settings, organization, profile, account, and property-management access.

This conflicts with the final Super Admin boundary. Navigation hiding is insufficient.

Before implementation may expose the Super Admin provisioning flow, a separately approved additive security migration must:

- separate platform-container provisioning from hotel business management;
- remove platform membership as implicit hotel-business authorization;
- prevent direct platform DML from replacing the provisioning RPC;
- preserve the Hotel L&D Manager’s existing administration authority;
- preserve RLS, server authorization, transactionality, and existing audit evidence;
- leave D0–D4 fact semantics unchanged.

No migration is created by this design checkpoint.

## 4. E0-C initialization stages

### Stage C1 — Property container and manager invitation

Super Admin supplies only:

- tenant/property code and container identity;
- preliminary property names required for initial branded context;
- primary hostname context;
- timezone and default language;
- initial manager User ID, display name, and temporary credential.

The system must:

1. validate the normalized values;
2. show a redacted zero-write confirmation preview;
3. require explicit confirmation;
4. create the property container and invitation through one narrow server-authorized operation;
5. compensate by removing a newly created Auth identity if the database operation fails;
6. return a redacted handoff state.

The manager account begins as invited or password-change-required. The property is not business-ready merely because the container exists.

### Stage C2 — Manager activation and business confirmation

The invited Hotel L&D Manager:

1. signs in through the hotel-branded User ID + Password flow;
2. completes the required password change;
3. confirms the hotel identity and business rules;
4. saves and re-reads authoritative server state.

Super Admin cannot perform this confirmation through platform authority.

### Stage C3 — Organization and scope readiness

The Hotel L&D Manager confirms:

- at least one active official department;
- the department hierarchy required by the Pilot;
- operational units when they are needed;
- positions and position families needed by the employee baseline;
- Department Training Responsible Person accounts and explicit scopes when the Pilot will use that role.

Department scope uses official branches and an explicit descendant setting. Frontend visibility and direct URL authorization must agree.

### Stage C4 — Employee baseline

The Hotel L&D Manager uses the existing D0 workflow:

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

The workflow:

- preserves employee numbers as text;
- excludes training history and CTC/GTC completion facts;
- creates no Auth user or backend account;
- never guesses employee identity, department, position, date, or status;
- never deactivates an employee merely because one workbook omits them;
- preserves Employee Fact Version and import audit semantics.

## 5. Employee baseline readiness states

Baseline readiness is recorded inside the existing import approval evidence. It does not create a new fact table or alter Employee Fact Version meaning.

| State | Meaning | E0-C decision boundary |
|---|---|---|
| **Full** | The expected current property employee population is committed; material exceptions are resolved or explicitly excluded in existing import evidence. | May support a property-wide initialization conclusion for the committed as-of date. |
| **Restricted** | The committed baseline is broadly usable, but declared limitations remain outside or immaterial to the intended Pilot scope. | E0-C may pass only with the limitations visible and the intended Pilot scope provably unaffected. |
| **Pilot Limited** | Only one named department branch or bounded cohort has a trustworthy committed baseline. The rest of the property remains outside the Pilot boundary. | E0-C may pass only for the named scope; no property-wide completeness claim is allowed. |

`No Go` or `Blocked` is a gate outcome, not a baseline state.

Perfect property-wide data is not required. Every employee inside the declared ready scope must still have:

- resolved identity and external identifier;
- an effective Employee Fact Version;
- resolved official department;
- position and status evidence required for future eligibility;
- no unresolved conflict that would change identity, department authorization, or future eligibility.

Missing evidence remains missing. It is never converted to zero, inactive, `Not Applicable`, or complete.

## 6. E0-C initialization success criteria

E0-C passes only when these four conditions are backed by authoritative data:

### 6.1 Property ready

- property container exists under the intended tenant;
- hostname resolves to the intended property;
- the Hotel L&D Manager has confirmed the hotel business profile and rules;
- initialization is finite, reviewable, and not trapping the manager.

### 6.2 Manager ready

- at least one Hotel L&D Manager account is active;
- property and tenant memberships are active;
- manager role assignment is active;
- required password change is complete;
- the final active manager protection remains effective.

### 6.3 Organization ready

- at least one active official department exists;
- Pilot departments, positions, and attribution foundations are confirmed;
- any Department Training Responsible Person has an active account and explicit official scope;
- unrelated-department and self-scope-widening access is denied.

### 6.4 Employee baseline ready

- one zero-write preview was explicitly approved;
- the exact preview version/hash was committed transactionally;
- the commit was authoritatively re-read;
- People Center reflects the committed employees;
- the baseline is classified as `Full`, `Restricted`, or `Pilot Limited`;
- declared ready-scope employees have no blocking identity or organization issue;
- no employee Auth user or backend account was created.

No Requirement, Plan, Session, Attendance, or Completion record is needed for E0-C success.

## 7. Separate Pilot Training Cycle

The Pilot Training Cycle begins only after E0-C passes and receives separate approval.

It uses existing capabilities:

- D1 Requirement Version and Eligibility Evaluation;
- D2 Training Plan Version, Session Revision, and Participant Snapshot;
- D3 Attendance Observation, Evidence, and Determination;
- D4 Completion Evidence and Completion Record.

Its success criteria are:

1. **Requirement created** — one governed Requirement Version is effective with an accepted learning method.
2. **Training delivered** — one immutable Session Revision is actually delivered; publication alone is insufficient.
3. **Attendance recorded** — one register is reconciled and closed with explicit determinations.
4. **Completion verified** — one reviewed Completion Record traces to valid evidence and immutable source versions.

This separate cycle must preserve:

- Eligibility is not Assignment;
- Published Session is not Delivered Session;
- QR Observation is not Attendance Determination;
- Attendance is not Completion.

E0-C neither implements nor verifies this cycle.

## 8. E0-C review stops

| Review stop | Evidence required | Stop condition |
|---|---|---|
| **C0 — Security boundary** | Platform/hotel authorization separation and approved migration impact | Platform authority can read or mutate hotel business data |
| **C1 — Property handoff** | Redacted preview, container creation, invitation, hotel login path | Partial property, orphaned identity, unusable invitation, or hostname ambiguity |
| **C2 — Manager readiness** | Active manager, password change, saved/re-read hotel profile | Manager inactive, membership/role invalid, or business profile unconfirmed |
| **C3 — Organization and scope** | Official organization and direct-route authorization evidence | Scope ambiguity, self-widening, or unrelated-department access |
| **C4 — Employee baseline** | Zero-write preview, exact commit evidence, classification, People Center re-read | Stale preview, guessed mapping, unresolved ready-scope employee, or unclassified baseline |
| **C5 — E0-C close** | Four initialization success criteria and redacted report | Any criterion unavailable, misleading, or supported only by mock data |

Failure stops E0-C. It does not authorize a Pilot Training Cycle, synthetic repair, direct DML, or broader scope.

## 9. Interaction and evidence contract

Every enabled action must make a real authorized transition, navigate to a real page, or explain why it is unavailable.

Each initialization stage preserves:

- actor;
- time;
- property and authorized scope;
- action and target;
- preview version/hash or authoritative record version;
- before/after or transition evidence where applicable;
- conflict or failure reason;
- authoritative re-read result.

E0-C does not require external owner signatures. The authorized Super Admin or Hotel L&D Manager records the relevant product decision through the governed transition.

## 10. Migration impact

No migration is created at this checkpoint.

A separately approved additive migration is expected to:

- create a narrow platform provisioning assertion and RPC;
- remove implicit platform authority from hotel business helpers and policies;
- prevent direct platform DML from bypassing the provisioning RPC;
- preserve property and invitation actor/time evidence using existing tenancy, membership, role, account, and initialization records;
- extend existing employee import approval evidence with `Full`, `Restricted`, or `Pilot Limited` metadata;
- add a read-only manager-scoped initialization-readiness RPC if existing repositories cannot safely supply the four criteria.

The migration must not:

- create a new readiness-fact table;
- create a new training-business table;
- alter D0–D4 historical meaning;
- create any Requirement, Plan, Session, Attendance, or Completion record;
- be applied to Production without separate explicit approval.

## 11. Explicit non-scope

E0-C does not introduce:

- the Pilot Training Cycle;
- Course or Requirement creation;
- Training Plan or Session creation;
- Attendance, QR, or Completion creation;
- D5;
- KPI;
- Forecast;
- AI;
- Feedback;
- automation;
- Health;
- Risk;
- reminder or notification;
- employee login;
- a hotel-user multi-property console.

## 12. Design acceptance

This design is accepted when:

- E0-C ends at a committed, classified employee baseline;
- Super Admin creates only the Property container and initial manager invitation;
- Hotel L&D Manager confirms business property, organization, scopes, and employee baseline;
- the four E0-C success criteria are authoritative and independently visible;
- the four Pilot Training Cycle criteria are documented but excluded from E0-C;
- no new readiness or training fact is introduced;
- no platform authority silently becomes hotel business authority;
- no implementation crosses a failed Review Stop;
- Production remains untouched until separately approved.
