# Hotel Learning & Development OS Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chinese-first, premium, static high-fidelity prototype of Hotel Learning & Development OS with coherent local mock data, hierarchy-driven scope, and navigable operational workflows.

**Architecture:** A Sites-initialized React/Vite application will use React Router for navigable pages, a typed in-memory mock repository for all business data, and a shared department-scope context consumed by dashboards, filters, calendar, people, QR, permissions, and reporting. Feature folders own page composition and feature-specific components; shared UI, hierarchy, formatting, and mock state remain centralized to prevent cross-module drift.

**Tech Stack:** Sites vinext starter, React, TypeScript, React Router, CSS modules/global design tokens, Vitest, React Testing Library, Lucide icons, and Recharts if already compatible with the initialized starter.

## Global Constraints

- Build Milestone 1 as a static high-fidelity prototype with local mock data only.
- Do not connect a database, create backend APIs, or add network persistence.
- Do not implement real authentication; use a local mock role switcher only.
- Do not implement real Excel parsing; simulate predetermined import states.
- Primary UI language is Chinese; English is secondary and used only where useful.
- Employee identity supports Chinese name, English name, and natural employee ID.
- Department hierarchy is the scope model across every module.
- All requested modules must be independently navigable.
- Every primary action must open a panel/dialog, change visible mock state, navigate, or show a confirmation/toast.
- Do not expose UUIDs, database keys, tokens, or technical field names.
- Preserve the approved Contemporary Hotel Intelligence palette and premium visual direction.
- Do not use model-authored SVG artwork; use typography, CSS, charts, and an established icon package.
- Keep all mock mutations in memory; refreshing the page may reset the prototype.

---

## Proposed File Structure

```text
app/
  layout.tsx                         # Site metadata and root document shell
  page.tsx                           # Application entry and router mount
  globals.css                        # Tokens, reset, typography, shared utilities
  router.tsx                         # Route definitions and page-level lazy boundaries
  providers.tsx                      # Mock session, scope, and prototype feedback providers
  types/
    domain.ts                        # Shared business entities and unions
    ui.ts                            # Filter, dialog, navigation, and chart view models
  data/
    departments.ts                   # Bilingual hierarchy fixture
    employees.ts                     # Employee fixtures
    courses.ts                       # Course and trainer fixtures
    sessions.ts                      # Sessions, attendance, and feedback fixtures
    kpis.ts                          # KPI definitions, targets, overrides, and results
    risks.ts                         # Risk fixtures
    permissions.ts                   # Roles, accounts, and scopes
    imports.ts                       # Mock import jobs and validation issues
    repository.ts                    # Stable typed access to all fixtures
  lib/
    department-tree.ts               # Tree building, ancestry, descendants, aggregation scope
    kpi-math.ts                      # Target resolution, completion, gap, health score
    format.ts                        # Chinese-first dates, values, percentages, names
    session-status.ts                # Status labels, order, and visual semantics
    prototype-actions.ts             # In-memory action results and toast messages
  state/
    department-scope.tsx             # Active scope context and breadcrumb behavior
    mock-role.tsx                    # Super-admin/department-admin prototype context
    prototype-feedback.tsx           # Toast and confirmation state
  components/
    shell/                           # AppShell, Sidebar, TopBar, scope and role controls
    ui/                              # Button, Card, Dialog, Drawer, Tabs, Badge, EmptyState
    hierarchy/                       # DepartmentTree, ScopePicker, Breadcrumbs
    dashboard/                       # KPI cards, insight, ranking, charts, risks
    calendar/                        # Calendar views, event cards, filters
    sessions/                        # Session panels, QR actions, roster, feedback summary
    people/                          # Employee table/cards/profile and action panels
    kpi/                             # Target editors, overrides, weights, health preview
    permissions/                     # Role and scope views, trainer assignment
    import/                          # Stepper, mapping, preview, issue resolution, history
    mobile/                          # QR headers, department steps, employee cards, success
  features/
    executive/ExecutiveDashboardPage.tsx
    organization/OrganizationDashboardPage.tsx
    calendar/TrainingCalendarPage.tsx
    sessions/TrainingSessionDetailPage.tsx
    qr/CheckInPage.tsx
    qr/FeedbackPage.tsx
    people/PeopleCenterPage.tsx
    kpi/KpiTargetCenterPage.tsx
    permissions/OrganizationPermissionsPage.tsx
    import/ImportCenterPage.tsx
    effectiveness/CourseEffectivenessPage.tsx
    risk/RiskDashboardPage.tsx
  tests/
    department-tree.test.ts
    kpi-math.test.ts
    routing.test.tsx
    hierarchy-scope.test.tsx
    executive-dashboard.test.tsx
    calendar-session.test.tsx
    qr-flows.test.tsx
    people-actions.test.tsx
    kpi-targets.test.tsx
    permissions.test.tsx
    import-workflow.test.tsx
    primary-actions.test.tsx
public/
  og.png                              # Bespoke social preview generated after UI stabilizes
docs/superpowers/
  specs/2026-07-11-hotel-learning-development-os-design.md
  plans/2026-07-11-hotel-learning-development-os-milestone-1.md
```

## Task Breakdown

### Task 1: Initialize the Sites application and establish the visual foundation

**Files:**
- Create through Sites initializer: `package.json`, `.openai/hosting.json`, starter `app/*`
- Modify: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `app/router.tsx`, `app/providers.tsx`, `app/types/ui.ts`
- Test: `app/tests/routing.test.tsx`

**Interfaces:**
- Produces: `AppProviders({ children }: PropsWithChildren)`, `AppRouter()`, global CSS tokens, and named route constants.

- [ ] **Step 1: Initialize once and start the retained development preview** using the Sites initializer, preserving its package manager and `.openai/hosting.json`.
- [ ] **Step 2: Add the route smoke test** asserting the root renders `学习与发展总览` and navigation exposes all required Chinese-first module names.
- [ ] **Step 3: Run the route test and confirm it fails** because the product router does not yet exist.
- [ ] **Step 4: Replace starter metadata and loading UI** with product title `酒店学习与发展运营系统 | Hotel Learning & Development OS`, mount `AppProviders` and `AppRouter`, and remove unused starter preview assets.
- [ ] **Step 5: Define exact visual tokens** for ivory, ink, champagne, teal, warning, critical, borders, shadows, radii, spacing, and Chinese-first typography in `globals.css`.
- [ ] **Step 6: Run the test and build**; expect the route test and production build to pass.
- [ ] **Step 7: Commit** with `feat: establish Hotel L&D OS application foundation`.

### Task 2: Define domain types and coherent mock data

**Files:**
- Create: `app/types/domain.ts`
- Create: all files under `app/data/`
- Test: `app/tests/mock-data.test.ts`

**Interfaces:**
- Produces: typed entities `Department`, `Employee`, `Course`, `Trainer`, `TrainingSession`, `Attendance`, `Feedback`, `KpiDefinition`, `KpiTargetOverride`, `KpiResult`, `RiskItem`, `Role`, `UserAccount`, and `ImportJob`.
- Produces: `mockRepository` with read-only fixture collections and lookup methods.

- [ ] **Step 1: Write fixture integrity tests** requiring one root hotel, 7 top-level departments, at least 20 total departments, 80 employees, 12 courses, 18 sessions, 8 KPI definitions, and valid foreign-key relationships.
- [ ] **Step 2: Add bilingual uniqueness assertions** ensuring every department has `nameZh`, `nameEn`, `parentId`, `level`, and `path`, and every employee has `employeeId`, `nameZh`, `nameEn`, `departmentId`, and `positionId`.
- [ ] **Step 3: Run tests and confirm failure** because fixtures are absent.
- [ ] **Step 4: Implement domain unions and interfaces** including `SessionStatus`, `PeriodType`, `RiskSeverity`, `EmploymentStatus`, and `TrainingCompletionStatus`.
- [ ] **Step 5: Create realistic fixtures** with the approved Rooms → Front Office → Concierge/Front Desk hierarchy and varied KPI, attendance, feedback, and risk outcomes.
- [ ] **Step 6: Implement `mockRepository` lookups** such as `department(id)`, `employee(id)`, `session(id)`, and scoped collection access.
- [ ] **Step 7: Run fixture tests and build**; expect all integrity checks to pass.
- [ ] **Step 8: Commit** with `feat: add coherent hotel training mock domain`.

### Task 3: Implement department-tree scope and KPI calculation contracts

**Files:**
- Create: `app/lib/department-tree.ts`, `app/lib/kpi-math.ts`, `app/lib/format.ts`
- Create: `app/state/department-scope.tsx`
- Test: `app/tests/department-tree.test.ts`, `app/tests/kpi-math.test.ts`

**Interfaces:**
- Produces: `buildDepartmentTree(departments)`, `getAncestors(id)`, `getDescendantIds(id)`, `isWithinScope(candidateId, scopeId)`, `getDepartmentBreadcrumb(id)`.
- Produces: `resolveTarget(kpiId, departmentId, period)`, `calculateCompletion(actual, target, direction)`, `calculateGap(actual, target)`, `calculateHealthScore(results, definitions)`.
- Produces: `useDepartmentScope()` returning `{ departmentId, setDepartmentId, descendantIds, breadcrumb }`.

- [ ] **Step 1: Write hierarchy tests** proving Rooms includes Front Office, Concierge, and Front Desk; Concierge does not include sibling Front Desk; breadcrumbs resolve in root-to-leaf order.
- [ ] **Step 2: Write KPI tests** proving department override inheritance, actual/target completion, signed gap, threshold state, and capped weighted Health Score.
- [ ] **Step 3: Run tests and confirm failure** due to missing functions.
- [ ] **Step 4: Implement hierarchy utilities** as pure functions with cycle protection and deterministic sibling order.
- [ ] **Step 5: Implement target resolution** using direct override, nearest ancestor override, then hotel target.
- [ ] **Step 6: Implement KPI math and Chinese value formatting** with explicit higher-is-better support for Milestone 1.
- [ ] **Step 7: Implement the scope provider** and keep selected scope in memory only.
- [ ] **Step 8: Run focused tests and full build**; expect all calculations and tree assertions to pass.
- [ ] **Step 9: Commit** with `feat: add hierarchy-driven scope and KPI math`.

### Task 4: Build the premium application shell and shared interaction primitives

**Files:**
- Create: `app/components/shell/*`, `app/components/ui/*`, `app/components/hierarchy/*`
- Create: `app/state/mock-role.tsx`, `app/state/prototype-feedback.tsx`
- Modify: `app/providers.tsx`, `app/router.tsx`
- Test: `app/tests/hierarchy-scope.test.tsx`, `app/tests/primary-actions.test.tsx`

**Interfaces:**
- Produces: `AppShell`, `DepartmentScopePicker`, `DepartmentTree`, `RoleSwitcher`, `Dialog`, `Drawer`, `ToastProvider`, `ConfirmDialog`, and `Button`.
- `DepartmentTree` consumes `selectedId`, `onSelect(id)`, and optional `allowedScopeIds`.

- [ ] **Step 1: Write interaction tests** for expanding Rooms, selecting Front Office, showing the bilingual breadcrumb, switching mock role, and receiving a visible toast from a primary action.
- [ ] **Step 2: Run tests and confirm failure** because shell and primitives do not exist.
- [ ] **Step 3: Implement accessible UI primitives** with focus management, Escape closing, labeled icon buttons, and visible focus states.
- [ ] **Step 4: Implement responsive shell and navigation** with Chinese primary and restrained English secondary labels.
- [ ] **Step 5: Implement hierarchy controls** shared by dashboard, filters, people, KPI overrides, and QR flows.
- [ ] **Step 6: Implement mock role restrictions** for `ld_manager` and `department_admin`, including a visible scope chip.
- [ ] **Step 7: Run tests and build**; expect shell interactions and scope propagation to pass.
- [ ] **Step 8: Commit** with `feat: build premium scoped application shell`.

### Task 5: Implement Executive, Organization, Effectiveness, and Risk dashboards

**Files:**
- Create: `app/components/dashboard/*`
- Create: `app/features/executive/ExecutiveDashboardPage.tsx`
- Create: `app/features/organization/OrganizationDashboardPage.tsx`
- Create: `app/features/effectiveness/CourseEffectivenessPage.tsx`
- Create: `app/features/risk/RiskDashboardPage.tsx`
- Test: `app/tests/executive-dashboard.test.tsx`, `app/tests/dashboard-scope.test.tsx`

**Interfaces:**
- Consumes: `useDepartmentScope`, KPI math, risks, sessions, attendance, and feedback fixtures.
- Produces: `KpiMetricCard` accepting actual, target, completion, gap, period, trend, and status.

- [ ] **Step 1: Write tests** asserting each Executive KPI card exposes actual, target, completion, gap, selected period, and prior-period trend.
- [ ] **Step 2: Add scope tests** asserting Rooms and Concierge show different values and Organization drill-down ends at a scoped employee list.
- [ ] **Step 3: Run tests and confirm failure** because dashboard components are absent.
- [ ] **Step 4: Build the Executive first viewport** with management insight, Health Score, KPI hierarchy, department ranking, course effectiveness, risks, and priorities.
- [ ] **Step 5: Build Organization drill-down** with tree, breadcrumbs, child comparisons, training status, risks, and employee preview.
- [ ] **Step 6: Build Course Effectiveness and Risk pages** using the same period and department scope contracts.
- [ ] **Step 7: Connect every chart/card action** to a visible detail drawer, filtered page navigation, or scope change.
- [ ] **Step 8: Run dashboard tests and build**; expect all target and scope assertions to pass.
- [ ] **Step 9: Commit** with `feat: add hierarchy-aware learning dashboards`.

### Task 6: Implement the operational calendar and session details

**Files:**
- Create: `app/components/calendar/*`, `app/components/sessions/*`
- Create: `app/features/calendar/TrainingCalendarPage.tsx`
- Create: `app/features/sessions/TrainingSessionDetailPage.tsx`
- Create: `app/lib/session-status.ts`
- Test: `app/tests/calendar-session.test.tsx`

**Interfaces:**
- Produces: month/week/day calendar views, `CreateSessionPanel`, `SessionQuickView`, and `QrActionCard`.
- Consumes: active scope, courses, trainers, departments, sessions, attendance, and feedback.

- [ ] **Step 1: Write tests** for switching views, applying department/trainer/status/type/mandatory filters, clicking a date, completing required session fields, and opening session detail.
- [ ] **Step 2: Add QR action assertions** requiring both check-in and feedback previews to open and expose navigable mock links.
- [ ] **Step 3: Run tests and confirm failure** because the calendar feature is absent.
- [ ] **Step 4: Implement full-size calendar views** with readable status cards and conflict-aware time layout.
- [ ] **Step 5: Implement session creation panel** for course, audience, trainer, date/time, location, capacity, status, and QR actions.
- [ ] **Step 6: Implement session detail** with status timeline, attendance roster, department breakdown, feedback progress, reminders, and make-up action.
- [ ] **Step 7: Ensure every primary action responds visibly** using drawers, dialogs, navigation, mock list updates, or toasts.
- [ ] **Step 8: Run tests and build**; expect all calendar and session interactions to pass.
- [ ] **Step 9: Commit** with `feat: add operational training calendar and sessions`.

### Task 7: Implement mobile QR check-in and feedback flows

**Files:**
- Create: `app/components/mobile/*`
- Create: `app/features/qr/CheckInPage.tsx`, `app/features/qr/FeedbackPage.tsx`
- Test: `app/tests/qr-flows.test.tsx`

**Interfaces:**
- Consumes: hierarchy utilities, employee scope, session, attendance, and feedback fixtures.
- Produces: local route flows `/check-in/:sessionId` and `/feedback/:sessionId`.

- [ ] **Step 1: Write check-in test** following top-level department → sub-department → employee search → identity confirmation → success.
- [ ] **Step 2: Assert employee cards show** ID, Chinese name, English name, department, position, and current check-in status.
- [ ] **Step 3: Write feedback test** selecting/searching an employee, rating, commenting, confirming, and seeing success.
- [ ] **Step 4: Run tests and confirm failure** because QR pages are absent.
- [ ] **Step 5: Implement mobile-first department steps** with path visibility, large touch targets, back behavior, and name/ID search.
- [ ] **Step 6: Implement in-memory attendance and feedback submission** with already-submitted states and no private response exposure.
- [ ] **Step 7: Run QR tests at mobile semantics and build**; expect both flows to pass.
- [ ] **Step 8: Commit** with `feat: add department-tree QR attendance flows`.

### Task 8: Implement People Center and employee operations

**Files:**
- Create: `app/components/people/*`
- Create: `app/features/people/PeopleCenterPage.tsx`
- Test: `app/tests/people-actions.test.tsx`

**Interfaces:**
- Consumes: active department scope, employees, assignments, sessions, risks, positions.
- Produces: searchable directory, responsive employee cards/table, profile drawer, edit, batch, assignment, and make-up panels.

- [ ] **Step 1: Write tests** for Chinese/English/ID search, hierarchy filtering, opening profile, editing department/position, changing active state, batch selection, assigning training, and creating make-up training.
- [ ] **Step 2: Run tests and confirm failure** because People Center is absent.
- [ ] **Step 3: Build the premium directory** with identity-first rows, completion indicators, required training, new employee status, and risk tags.
- [ ] **Step 4: Build employee profile** with training history, required courses, risks, and contextual actions.
- [ ] **Step 5: Implement visible in-memory action responses** and an Import Center entry point.
- [ ] **Step 6: Add responsive card presentation** for narrow viewports.
- [ ] **Step 7: Run tests and build**; expect all daily maintenance actions to pass.
- [ ] **Step 8: Commit** with `feat: add operational People Center`.

### Task 9: Implement first-class KPI Target Center

**Files:**
- Create: `app/components/kpi/*`
- Create: `app/features/kpi/KpiTargetCenterPage.tsx`
- Test: `app/tests/kpi-targets.test.tsx`

**Interfaces:**
- Consumes: KPI definitions, target resolution, hierarchy tree, and Health Score calculation.
- Produces: KPI catalog, editor, period targets, threshold preview, department overrides, weight distribution, and active state.

- [ ] **Step 1: Write tests** editing KPI name/formula, month/quarter/year targets, warning/critical thresholds, weight, hotel target, department override, and active state.
- [ ] **Step 2: Assert inheritance behavior** where Concierge inherits Front Office override until it receives a direct override.
- [ ] **Step 3: Assert a visible warning** when active weights do not total 100%.
- [ ] **Step 4: Run tests and confirm failure** because the KPI module is absent.
- [ ] **Step 5: Implement the target catalog and editor** with Chinese business-language descriptions and period tabs.
- [ ] **Step 6: Implement override tree and inheritance preview** using shared hierarchy utilities.
- [ ] **Step 7: Implement threshold and Health Score previews** with visible in-memory save confirmation.
- [ ] **Step 8: Run tests and build**; expect target editing and inheritance assertions to pass.
- [ ] **Step 9: Commit** with `feat: add KPI target operations center`.

### Task 10: Implement Organization & Permissions

**Files:**
- Create: `app/components/permissions/*`
- Create: `app/features/permissions/OrganizationPermissionsPage.tsx`
- Test: `app/tests/permissions.test.tsx`

**Interfaces:**
- Consumes: departments, positions, trainers, roles, accounts, and mock-role context.
- Produces: department editor, position manager, trainer assignment, role list, invitation panel, and scope preview.

- [ ] **Step 1: Write tests** for department selection/edit response, position management, trainer assignment, role capability summary, mock invitation, and department-admin restriction.
- [ ] **Step 2: Run tests and confirm failure** because permission screens are absent.
- [ ] **Step 3: Implement organization management panels** with natural bilingual labels and no exposed internal IDs.
- [ ] **Step 4: Implement trainer assignment and role scope preview** using the shared hierarchy tree.
- [ ] **Step 5: Implement mock invitation and role switching** with visible success feedback.
- [ ] **Step 6: Verify restricted role behavior** across navigation and actions.
- [ ] **Step 7: Run tests and build**; expect scope and restriction assertions to pass.
- [ ] **Step 8: Commit** with `feat: add organization and permission prototype`.

### Task 11: Implement the complete mock Import Center workflow

**Files:**
- Create: `app/components/import/*`
- Create: `app/features/import/ImportCenterPage.tsx`
- Test: `app/tests/import-workflow.test.tsx`

**Interfaces:**
- Consumes: predetermined import fixtures and prototype feedback.
- Produces: an 8-stage local UI workflow and history view; accepts no real workbook contents.

- [ ] **Step 1: Write tests** traversing upload, sheet detection, field mapping, preview, duplicate employees, unmatched departments, unmatched courses, confirmation, and history.
- [ ] **Step 2: Assert the file input never triggers parsing or network calls** and advances only into predetermined mock state.
- [ ] **Step 3: Run tests and confirm failure** because Import Center is absent.
- [ ] **Step 4: Implement the stepper and mock upload state** with realistic Chinese copy and detected sheet names.
- [ ] **Step 5: Implement mapping, preview, and issue-resolution screens** with representative counts and row examples.
- [ ] **Step 6: Implement confirmation and import history** with a visible mock completion result.
- [ ] **Step 7: Run tests and build**; expect the entire simulated workflow to pass.
- [ ] **Step 8: Commit** with `feat: add guided mock import workflow`.

### Task 12: Complete cross-module action coverage, responsive polish, and final verification

**Files:**
- Modify: affected `app/components/**`, `app/features/**`, `app/globals.css`, `app/layout.tsx`
- Create or modify: `app/tests/primary-actions.test.tsx`
- Create: `public/og.png` only after the site direction and content are stable

**Interfaces:**
- Consumes: all completed modules.
- Produces: final high-fidelity Sites prototype ready for hosting.

- [ ] **Step 1: Build a primary-action inventory test** that clicks every primary page action and asserts navigation, dialog, drawer, visible state change, confirmation, or toast.
- [ ] **Step 2: Run the inventory test and record failures** by page; do not accept inert primary buttons.
- [ ] **Step 3: Fix each inert action** using the smallest appropriate prototype response without adding backend behavior.
- [ ] **Step 4: Verify Chinese-first copy** across navigation, headings, forms, status labels, validation, success, error, and empty states.
- [ ] **Step 5: Verify hierarchy consistency** by selecting Concierge and confirming dashboards, calendar, people, KPI overrides, risks, reports, permissions, and QR employee choices respect scope.
- [ ] **Step 6: Check desktop, tablet, and mobile layouts** with special attention to calendar density, data tables, dialogs, and QR touch targets.
- [ ] **Step 7: Verify accessibility** for keyboard navigation, focus visibility, dialog focus, labels, color contrast, status text, and touch size.
- [ ] **Step 8: Generate and inspect one bespoke social preview** matching the finished bilingual product; wire it only if its text is correct.
- [ ] **Step 9: Run the complete test suite and production build**; expect zero failures and successful Cloudflare-compatible output.
- [ ] **Step 10: Perform the requested browser verification** of navigation and primary interactions without introducing production services.
- [ ] **Step 11: Commit** with `feat: complete Hotel L&D OS milestone 1 prototype`.
- [ ] **Step 12: Invoke the Sites hosting workflow** and publish the validated prototype.

## Milestone Verification Matrix

| Requirement | Primary task | Verification |
|---|---:|---|
| Chinese-first bilingual UI | 1, 4, 12 | Copy audit and route/action tests |
| Hierarchy drives all scope | 3, 4, 12 | Unit tests plus Concierge cross-module audit |
| Executive KPI target completion | 3, 5 | Card contract tests |
| KPI Target Center and overrides | 3, 9 | Target inheritance and weight tests |
| Operational calendar creation | 6 | Calendar/session interaction tests |
| Department-tree QR check-in | 7 | End-to-end component test |
| QR feedback | 7 | End-to-end component test |
| People Center replaces daily Excel | 8 | Search/edit/batch/assignment tests |
| Organization and permissions | 10 | Scope and restricted-action tests |
| Mock import workflow | 11 | Full stepper test; no parsing/network assertion |
| Every primary button responds | 4–12 | Central primary-action inventory |
| Premium high-fidelity finish | 1, 4, 12 | Responsive and visual browser verification |
| No backend/auth/database/parsing | All | Dependency/code review and build inspection |

