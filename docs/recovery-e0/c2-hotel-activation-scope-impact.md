# Recovery E0-C2 — Hotel Activation and Organization Scope Impact

## Decision

Recovery C2 reuses the approved Recovery B organization, account/scope and
finite-activation foundations. **No migration is required.** The only product
addition is a manager-visible, read-only C2 readiness gate derived from
authoritative persisted facts.

## Existing authoritative operations reused

| C2 need | Existing protected operation | Authoritative result |
| --- | --- | --- |
| Confirm property identity and business rules | property repositories and versioned save RPCs | `properties` and `property_settings` |
| Complete finite activation | `complete_property_initialization` | `property_settings.initialization_state = ready` |
| Create and maintain official departments | `create_department`, `update_department_details`, move/review RPCs | department tree and closure table |
| Maintain operational units and positions | existing Recovery B management RPCs | organization foundations only |
| Assign a department responsible person | existing backend-account and explicit-scope RPCs | active role assignment and `trainer_scopes` |
| Resolve descendants | `app_private.has_authorized_department_scope` | active scope plus closure relation |

## Additive application behavior

`deriveC2EmployeeBaselineReadiness` reports a factual readiness conclusion
from: persisted activation state, active manager count, active official
department count, and active department-responsible assignments with explicit
scope. A department responsible person is optional; once one exists, every
active assignment must carry an active explicit scope before the C2 gate can
be ready.

The UI is informational only. It does not write an employee, Employee Fact
Version, course, requirement, plan, session, attendance, or completion record.
It does not change RLS, RPC grants, or D0–D4 fact semantics.

## Authorization and rollback

The access-summary route continues to require an active Hotel L&D Manager and
returns scope aggregates only for that manager's own property. It uses the
existing role assignment, active-account and `trainer_scopes` evidence; no
client claim is trusted for descendant access. Department responsible persons
remain unable to enter activation or hotel settings, and platform provisioners
remain outside hotel business authorization.

Because C2 has no schema or data mutation, rollback is a code-only revert of
the derived display and its read aggregate. Existing activation, organization,
scope and audit facts remain intact. No database rollback is needed.

## Verification contract

Focused C2 pgTAP proves manager-managed organization, server closure scope,
manager-only activation, department-role denial, platform isolation, and the
absence of employee and training facts. Application tests prove the derived
gate remains factual. Clean local reset, full pgTAP, application tests, build,
and local browser verification remain required before Review Stop C2.
