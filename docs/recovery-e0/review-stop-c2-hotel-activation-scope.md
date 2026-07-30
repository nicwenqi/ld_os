# Review Stop C2 — Hotel Activation and Organization Scope

## Result

**PASS — Property Ready for Employee Baseline.**

This review stop implements no employee baseline and no training fact. It
finishes only the hotel-side prerequisites: manager-confirmed finite
activation, official organization, operational-unit/position foundations, and
explicit department-responsible scope readiness.

## Product behavior

- The Hotel L&D Manager continues to use the existing five-section activation
  flow. Completion remains persisted by the existing authoritative activation
  RPC; it is finite, reviewable and never replaces the operations home.
- The activation review now displays a read-only C2 gate: **Property Ready for
  Employee Baseline** only when authoritative activation, an active manager,
  an active official department, and every active department-responsible
  assignment's explicit scope are confirmed.
- A department responsible person is optional. Once an active person is
  appointed, lack of an explicit scope makes the gate pending rather than
  silently treating the person as hotel-wide.
- Official department hierarchy, operational units and positions keep their
  existing manager-only, versioned RPC workflows. Descendants are resolved by
  the server closure table, never by a browser-provided list.

## Browser findings fixed during review

1. A completed local-review activation could leave the C2 gate pending because
   the UI read a stale property-settings value. The gate now resolves the
   authoritative initialization-progress state (or its persisted completion
   timestamp where needed) before deriving readiness.
2. The completed-activation return action was below the 44px mobile touch
   target. Primary and primary-link actions now have a 44px minimum height.
3. The platform provisioning page produced a missing route-style asset in the
   local production build. Its scoped style sheet is now imported by the
   global style entry, eliminating the missing asset without changing platform
   or hotel authorization.

## Authorization evidence

- Hotel L&D Manager: can activate a hotel, create official departments and
  create a department-responsible account with explicit scopes.
- Department Training Responsible Person: server resolution permits the
  assigned branch and configured descendants only; organization writes and
  activation completion are denied.
- Platform provisioner: cannot read organization or retain a hotel-business
  route. Platform and hotel cookies remain separate.
- No client-selected department scope is trusted. The access summary reports
  only manager-authorized aggregate scope facts for the current property.

## Database and migration status

No C2 migration was created. C2 reuses the existing Recovery B activation,
organization, account and scope RPC/RLS foundations. D0–D4 fact semantics are
unchanged. The focused C2 test proves the phase creates no employee, Employee
Fact Version, Requirement, Session, Attendance or Completion fact.

## Verification evidence

| Check | Result |
| --- | --- |
| Clean local Supabase reset through C1 migrations | PASS |
| Focused C2 pgTAP | PASS — 16 assertions |
| Full pgTAP suite | PASS — 25 files, 797 assertions |
| Application suite | PASS — 284 tests |
| Production build and rendered HTML | PASS |
| Browser manager activation, organization save and scope visibility | PASS |
| Browser department scope and hotel-settings denial | PASS |
| Browser platform-to-hotel isolation | PASS |
| Desktop/tablet/mobile overflow, normal zoom, keyboard focus, 44px critical targets | PASS |
| Browser console errors, failed requests and non-success responses | PASS |

Browser evidence was captured against the local production build using only
synthetic local-review identities. It showed the activation review at desktop
and mobile widths, organization administration at desktop width, and the
department workspace at tablet width. The local browser contexts, cookies,
screenshots and server are removed after the review.

## Explicit non-scope confirmation

No Production Supabase, Production deployment, DNS, production environment
variable, production account, property, department, employee or training data
was accessed or changed. No employee baseline was imported. Recovery C3 and
all D1–D4 business workflows remain untouched by this phase.
