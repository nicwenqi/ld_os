# Recovery A — Identity, Routes, Navigation and Truthful Home Experience

> Status: authorized for local implementation only. Recovery B, database migrations, production data changes, production deployment, DNS changes, and branch merging are out of scope.

## Product contract

The hotel-facing application exposes exactly two authenticated workspaces:

- Hotel L&D Manager (`property_ld_manager`) → `/`
- Department Training Responsible Person (application role `department_training_responsible`, mapped from the validated database role code `department_training_admin`) → `/department`

Anonymous protected requests go to `/login`. Authenticated accounts without either hotel role go to `/access-denied`. Platform and tenant isolation remain in the database foundation, but platform, tenant, employee, and property-selection workspaces are not exposed in the hotel product.

Recovery A must present only trusted foundation facts. Training sessions, attendance, feedback, KPI actuals, forecasts, health judgments, risks, and interventions remain unavailable until Recovery D. Missing facts are never rendered as zero, healthy, or invented values.

## Baseline evidence

- Baseline branch: `codex/initialization-usability-fix` at `320232f`.
- Baseline verification: 114 tests passed (113 source/unit tests plus rendered HTML), and the vinext production build completed.
- Current manager home hard-codes a health score, KPI actuals, trends, course performance, risks, and actions in `app/page.tsx`.
- Current department home uses a synthetic Front Office scope and has no server-resolved scope in `app/department/page.tsx`.
- Current application roles still include platform, tenant, employee, and department-admin variants in `app/repositories/contracts/auth-repository.ts` and `app/services/authentication-service.ts`.
- Current navigation and direct route guards diverge from the approved frequency model in `app/services/role-navigation.ts` and `app/services/auth-routing.ts`.
- Current shell exposes a static risk badge, notification toast, synthetic global department picker, and quick-create actions that only emit prototype toasts in `app/components/shell/AppShell.tsx`.
- Validated property, organization, position, employee, import, initialization, tenancy, and trainer-scope foundations remain reusable.

## Task 1 — Lock the two-role application authority model

**Files**

- Modify `app/repositories/contracts/auth-repository.ts`
- Modify `app/services/authentication-service.ts`
- Modify `app/services/auth-routing.ts`
- Modify `app/api/auth/login/route.ts` only if response typing requires it
- Modify `tests/authentication-entry.test.mjs`
- Add or modify `tests/recovery-a-routing.test.mjs`

**Behavior**

1. Replace application roles with `property_ld_manager`, `department_training_responsible`, and `unauthorized`.
2. Keep the validated database code `department_training_admin` as an internal server-side mapping only.
3. Stop mapping `platform_admin`, `tenant_admin`, `employee_participant`, and `property_member` to hotel workspaces.
4. Remove synthetic platform and employee accounts; retain only local manager, department-responsible, unauthorized, and disabled test fixtures.
5. Extend authenticated session data with authorized department-scope summaries loaded from existing `trainer_scopes` and `departments` facts. Do not create a schema or migration.
6. Require at least one active authorized department scope before a department-responsible account receives its workspace role; otherwise return `unauthorized`.

**TDD**

1. Write routing and synthetic-account tests that fail against the old role set.
2. Run only the Recovery A routing/auth tests and confirm the intended failure.
3. Implement the contract and rerun until green.

## Task 2 — Create one role-aware route and navigation registry

**Files**

- Modify `app/services/auth-routing.ts`
- Replace `app/services/role-navigation.ts`
- Modify `app/components/auth/SessionGate.tsx`
- Modify `tests/shell-source.test.mjs`
- Add `tests/recovery-a-navigation.test.mjs`

**Behavior**

1. Define the manager routes by frequency:
   - Daily: `/`, `/calendar`, `/sessions`, `/attendance-feedback`, `/people`, `/interventions`
   - Periodic: `/plans`, `/department-performance`, `/kpi`, `/effectiveness`, `/data-quality`
   - Administration: `/import`, `/permissions`, `/settings/hotel`, `/initialize`
2. Define department routes:
   - `/department`, `/department/calendar`, `/department/sessions`, `/department/employees`, `/department/attendance-feedback`, `/department/remediation`, `/department/data`
3. Use the same registry for visible navigation and direct URL authorization.
4. Preserve `/login` and `/access-denied` as public entry states.
5. Remove `/my-training` and `/platform` from the route model.
6. Treat unknown or disallowed authenticated routes as access-denied behavior, not silent privilege-based redirection to another workspace.
7. Preserve safe login return behavior only for a route authorized to the resolved role.

**TDD**

1. Add exact route-matrix assertions for both roles and forbidden cross-role paths.
2. Assert all navigation destinations are authorized for their role.
3. Assert no employee/platform path or hash pseudo-navigation remains.

## Task 3 — Rebuild the shared application shell

**Files**

- Replace `app/components/shell/AppShell.tsx`
- Modify `app/globals.css`
- Add `app/recovery-a.css`
- Modify `app/providers.tsx` if obsolete prototype providers can be removed safely
- Modify `tests/shell-source.test.mjs`
- Add `tests/recovery-a-interactions.test.mjs`

**Behavior**

1. Render calm Chinese-first frequency groups with a separate collapsible administration section for managers.
2. Render only the approved seven links for department-responsible users.
3. Replace the synthetic global scope picker with a read-only hotel context for managers and a server-authorized scope breadcrumb for department users.
4. Remove notification, static risk count, avatar toast, quick-create dialog, and all shell actions that only emit a prototype toast.
5. Retain a real logout action and a responsive, keyboard-usable mobile navigation drawer.
6. Show data-state text on unavailable destinations without using color alone.
7. Use existing ivory, ink, champagne, teal, coral, slate, Songti, and PingFang design tokens; improve spacing and type without introducing a parallel visual system.

**TDD**

1. Assert the exact approved labels and group order.
2. Assert the shell contains no `showToast`, fake risk badge, fake notification, quick create, or `DepartmentScopePicker`.
3. Assert mobile menu state and semantic navigation attributes exist.

## Task 4 — Build the truthful manager command center

**Files**

- Replace `app/page.tsx`
- Add `app/services/foundation-readiness.ts`
- Add `app/components/operations/DataStateBadge.tsx`
- Add `app/components/operations/FoundationReadiness.tsx`
- Add `app/components/operations/ModuleAvailability.tsx`
- Modify `app/repositories/registry.ts`
- Replace obsolete dashboard assertions in `tests/executive-dashboard.test.mjs`
- Add `tests/recovery-a-manager-home.test.mjs`

**Behavior**

1. Load only existing property, organization, position, employee, import, initialization, mapping, and manager-access facts.
2. Use all-settled/module-level error handling so one unavailable foundation source does not blank the home.
3. Begin with a categorical, evidence-backed conclusion: training operating health and trajectory cannot yet be judged because authoritative training facts are unavailable.
4. Show hotel identity, source classification, last refresh, minimum foundation readiness, connected foundation facts, unresolved foundation work, and one real next setup path.
5. Show training operations as `尚未接入真实数据`; never render a score, KPI actual, risk, forecast, attendance, feedback, hours, or intervention result.
6. Make every enabled call to action navigate to an existing authorized page.
7. Keep initialization as a compact administrator tool; do not render the old percentage card or redirect root.
8. Distinguish `real`, `demo`, `unavailable`, `partial`, and `load failed` states in visible Chinese text.

**TDD**

1. First assert the old fake tokens and hard-coded profiles are absent.
2. Assert all required truthful states and destinations are present.
3. Assert the readiness service never converts an unavailable source into zero or healthy.

## Task 5 — Build the scoped department workspace

**Files**

- Replace `app/department/page.tsx`
- Add `app/department/employees/page.tsx`
- Add shared department unavailable pages for calendar, sessions, attendance/feedback, remediation, and department data
- Add `app/components/operations/UnavailableOperationalPage.tsx`
- Add `tests/recovery-a-department-home.test.mjs`

**Behavior**

1. Render only server-resolved authorized department branches and the descendant policy.
2. Always show the active authorized scope and breadcrumb; never substitute a synthetic branch in real mode.
3. If scope facts cannot be loaded, show `授权范围暂时无法读取` and no department data.
4. Show the permitted employee-master view only after applying the authorized branch and descendant boundary in the UI in addition to existing RLS.
5. Show sessions, attendance, feedback, reminders, make-up training, and department performance as truthful unavailable modules.
6. Do not expose hotel settings, import, organization administration, accounts, global targets, or unrelated departments.
7. Give every page a clear return to `/department` and a working logout path through the shell.

**TDD**

1. Assert the department home uses `session.departmentScopes` and contains no synthetic Front Office copy.
2. Assert the department nav/direct-route matrix contains exactly seven destinations.
3. Assert manager administration links and hotel-wide labels are absent from department pages.

## Task 6 — Remove or truthfully retire prototype routes and modules

**Files**

- Delete `app/my-training/page.tsx`
- Delete `app/platform/page.tsx`
- Delete `app/check-in/session-1/page.tsx`
- Delete `app/feedback/session-1/page.tsx`
- Replace `app/calendar/page.tsx`
- Replace `app/effectiveness/page.tsx`
- Replace `app/kpi/page.tsx`
- Replace or retire `app/risk/page.tsx`
- Replace or retire `app/organization/page.tsx`
- Add manager unavailable route pages listed in Task 2
- Modify `app/people/page.tsx`
- Modify `app/permissions/page.tsx`
- Modify obsolete tests that enforce prototype behavior

**Behavior**

1. Remove predictable prototype QR routes completely; do not create replacement token schemas or routes.
2. Replace mock training/calendar/KPI/effectiveness/risk screens with premium unavailable states and evidence requirements.
3. Remove toast-only controls from retained foundation pages or disable them with a visible reason.
4. Replace hash-based administration entry links with query-driven, usable page state where a shared administration page remains.
5. Remove synthetic global department scope behavior from manager foundation pages.
6. Keep real settings, organization, position, employee, import, initialization, tenancy, property, and RLS foundations.

## Task 7 — Responsive, accessibility, and route-flow verification

**Files**

- Add `tests/recovery-a-truthfulness.test.mjs`
- Add `tests/recovery-a-accessibility.test.mjs`
- Update `package.json` test list
- Add screenshot artifacts under `artifacts/recovery-a/`

**Verification**

1. Run focused Recovery A tests.
2. Run `npm run lint` and fix introduced issues without unrelated rewrites.
3. Run the full `npm test` suite and update only obsolete product-assumption tests.
4. Run `npm run build` independently after the tests.
5. In the local app, verify manager, department-responsible, unauthorized, and anonymous flows.
6. Verify disallowed direct URLs for each role.
7. Inspect console errors and horizontal overflow at desktop 1440×900, tablet 1024×768, and mobile 390×844.
8. Verify keyboard focus, visible focus, semantic headings, status text, touch targets, readability at normal zoom, mobile drawer behavior, and return paths.
9. Capture desktop, tablet, and mobile screenshots of the completed manager home plus the department desktop home.
10. Compare the completed manager screenshot beside the existing manager-home reference and correct layout regressions.

## Task 8 — Review, Preview, and commit

1. Review the complete branch diff against this plan and the approved Recovery 0 constraints.
2. Confirm no migration, Supabase production, user, data, DNS, or production Vercel change occurred.
3. Confirm Recovery B work is absent.
4. Create a non-production Vercel Preview only after all local checks pass; never use `--prod` and never promote it.
5. Smoke-test the Preview if one is successfully created.
6. Commit the reviewed Recovery A changes on `codex/recovery-a`.

## Acceptance gate

Recovery A is complete only when the two-role entry contract, navigation/direct-route parity, truthful manager and department homes, unavailable module states, real return paths, responsive screenshots, local test/build results, Preview outcome, and production-protection confirmations can all be reported with evidence.
