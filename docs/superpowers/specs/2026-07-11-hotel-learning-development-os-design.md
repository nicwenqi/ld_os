# Hotel Learning & Development OS — Milestone 1 Design Specification

**Status:** Locked for user review  
**Milestone:** Static high-fidelity prototype  
**Primary user:** Hotel Learning & Development Manager / Super Administrator  
**Secondary user:** Department Training Administrator  

## 1. Product intent

Hotel Learning & Development OS is a Chinese-first hotel training operations system. It is not presented as a traditional LMS, HR administration table, or spreadsheet replacement. It gives the L&D Manager a coherent operational view of departments, employees, training plans and sessions, attendance, feedback, KPI targets, risks, and performance.

Milestone 1 must look and behave like a credible premium product. It uses local mock data and realistic interactions, without a database, real authentication, real messaging, or real Excel parsing.

## 2. Experience principles

1. **Chinese first, English second.** Primary interface text, actions, validation, empty states, insights, and status labels are Chinese. English appears as a smaller secondary label where it improves recognition. Employee identity supports Chinese and English names. Departments and courses may be bilingual.
2. **Hierarchy is the operating model.** The department tree drives dashboards, filters, QR check-in, employee scope, permissions, KPI overrides, risks, and reports. It is not limited to organization administration.
3. **Targets make metrics actionable.** KPI presentation always provides target context, completion, gap, period, and change from the previous period.
4. **Operational speed over administrative density.** Frequent tasks are short, clear, and contextual. Tables are reserved for genuinely tabular work and are softened with identity cells, status treatments, spacing, and contextual actions.
5. **Progressive disclosure.** Executive summaries lead to department, session, course, or employee detail without losing the current organizational context.
6. **Premium but restrained.** The interface uses an elegant hotel operations visual language without gamification, ornamental excess, or generic admin-dashboard styling.

## 3. Information architecture

### Global application shell

- Ink-blue left navigation with bilingual product identity
- Warm-ivory application canvas
- Top bar with hotel context, reporting period, notifications, help, and user menu
- Persistent department scope indicator when a department context is active
- Role-aware navigation and actions
- Global creation menu for training session, employee, assignment, and make-up training

### Primary modules

1. Executive L&D Dashboard / 学习与发展总览
2. Organization Dashboard / 组织培训看板
3. Training Calendar / 培训日历
4. Course Effectiveness / 课程成效
5. Risk Dashboard / 风险看板
6. People Center / 员工中心
7. KPI Target Center / KPI 目标中心
8. Organization & Permissions / 组织与权限
9. Import Center / 导入中心

### Contextual experiences

- Training Session Detail / 培训场次详情
- Mobile QR Check-in / 扫码签到
- Mobile QR Feedback / 扫码反馈
- Employee Profile / 员工档案
- Department Drill-down / 部门下钻

## 4. Department hierarchy and scope model

The prototype uses a realistic hierarchy such as:

- Rooms 房务部
  - Front Office 前厅部
    - Concierge 礼宾部
    - Front Desk 前台
    - Guest Relations 宾客关系
  - Housekeeping 客房部
    - Room Attendant 客房服务
    - Public Area 公共区域
    - Laundry 洗衣房

Every department carries a stable internal key, bilingual display name, parent, hierarchy path, level, employee count, and active state. Internal keys never appear in the interface.

Selecting `Rooms 房务部` aggregates all descendants. The user can then drill into `Front Office 前厅部`, then `Concierge 礼宾部`, and finally the scoped employee list. Breadcrumbs preserve the path and allow movement back up the hierarchy.

The active department scope affects:

- KPI actuals, targets, completion, rankings, and trends
- Training coverage, attendance, feedback, and risk calculations
- Calendar event visibility and creation defaults
- People Center filters and employee actions
- QR check-in department selection
- Department-level KPI override targets
- Department trainer permissions
- Reports and course-effectiveness views

Department Training Administrators can view employees, send mock reminders, create make-up training, and manage attendance and feedback only inside their assigned department branches. They cannot edit global KPI targets, access unrelated branches, manage global roles, or administer other users.

## 5. Page requirements

### 5.1 Executive L&D Dashboard

The first viewport begins with a Chinese management insight sentence generated from mock performance and risk data. It includes:

- Training Health Score
- Average training hours per employee
- Mandatory training coverage
- New employee completion rate
- Training plan completion rate
- Attendance rate
- Feedback response rate
- Average satisfaction score
- Department trainer coverage rate
- Department ranking
- Course effectiveness
- Risk summary
- Near-term management priorities

Every KPI card displays:

- Actual value / 实际值
- Target value / 目标值
- Completion percentage / 达成率
- Gap to target / 目标差距
- Selected period: month, quarter, or year
- Trend versus previous comparable period
- Status derived from warning and critical thresholds

Changing the reporting period or department scope updates all cards and charts consistently. Cards link to a contextual drill-down.

### 5.2 Organization Dashboard

- Persistent interactive department tree
- Hierarchy breadcrumbs and department summary header
- Department headcount and training status
- All relevant KPI actuals, targets, completion, gaps, and trends
- Child-department comparison
- Required-training coverage
- Attendance and feedback status
- Risk distribution
- Employee preview and link to scoped People Center

Tree selection updates the dashboard in place. Parent nodes aggregate descendants; leaf nodes expose employee-level detail.

### 5.3 Training Calendar

The calendar is a primary operational workspace, not a decorative widget.

- Month, week, and day views
- Prominent date navigation and today action
- Status-colored event cards with text labels
- Filters for department, trainer, status, course type, location, and mandatory/elective
- Click a date or time slot to open session creation
- Click a session to open quick view or full detail

Session creation supports:

1. Select course
2. Select department branch or target audience
3. Select trainer
4. Select date and time
5. Select or enter location
6. Set capacity and mandatory/elective status
7. Save as draft or publish in the mock interface
8. Generate QR check-in and QR feedback actions

Session statuses are Draft, Published, Notified, Check-in Open, Completed, Pending Feedback, Closed, and Cancelled, each shown with Chinese-first labels and accessible color treatment.

### 5.4 Training Session Detail

- Session summary, course, audience, trainer, time, location, capacity, and status
- Status timeline and contextual next action
- Attendance roster and feedback progress
- Department breakdown
- QR check-in and feedback cards
- QR preview, open mock page, and copy mock link actions
- Mock reminder, attendance management, feedback management, and make-up training actions

### 5.5 Mobile QR Check-in

The flow prioritizes speed and one-handed use:

1. Scan/open session page
2. Select top-level department
3. Select sub-department until a valid employee scope is reached
4. Search or select employee
5. Confirm employee identity and check-in
6. Show unambiguous success state

Search supports Chinese name, English name, and employee ID. Each employee card shows employee ID, Chinese name, English name, department, position, and current check-in status. Already checked-in employees remain visible but clearly identified. Large touch targets, back navigation, and the active department path are always clear.

### 5.6 Mobile QR Feedback

1. Open session feedback page
2. Select department and employee or search directly
3. Confirm identity
4. Submit satisfaction, relevance, trainer score, and optional comments
5. Show success state

The interface explains whether feedback has already been submitted without exposing private responses.

### 5.7 People Center

The People Center is designed to replace routine spreadsheet maintenance.

- Searchable employee list with saved operational filters
- Chinese name, English name, employee ID, department, position, status, completion, and risk presentation
- Employee profile
- Department and position editing
- New employee status
- Active/inactive status
- Training history
- Required-training status
- Risk tags
- Batch actions
- Import entry
- Assign training
- Create make-up training

Desktop uses a spacious, polished data grid with contextual identity cells. Narrow layouts use employee cards instead of compressing the table.

### 5.8 KPI Target Center

This is a first-class operational module, not a settings page. It supports the eight specified KPIs plus Training Health Score composition.

Each KPI definition includes:

- Chinese-first KPI name and optional English label
- Formula description in business language
- Monthly target
- Quarterly target
- Yearly target
- Warning threshold
- Critical threshold
- Weight in Training Health Score
- Hotel-level target
- Department-level override targets
- Active/inactive state

The module includes period tabs, target cards/list, editing panel, department override tree, threshold preview, weight distribution, and resulting Training Health Score preview. It warns when active KPI weights do not total 100%. Department overrides inherit from the nearest configured ancestor when no direct override exists.

### 5.9 Organization & Permission Center

- Department tree management
- Position management
- Department trainer assignment
- Role management
- User account invitations
- Department-scope preview
- Clear capability summary for each role

Mock role switching demonstrates the difference between the L&D Manager and a Department Training Administrator. No real authentication is implemented.

### 5.10 Import Center

The mock UI presents a credible end-to-end workflow:

1. Upload Excel
2. Detect sheets
3. Select relevant sheets
4. Map source fields to system fields
5. Preview additions and changes
6. Identify duplicate employees
7. Identify unmatched departments
8. Identify unmatched courses
9. Resolve or exclude mock issues
10. Confirm import
11. View completion summary and import history

The prototype simulates detection, mapping, validation, and confirmation with predetermined mock states. It does not read or parse an actual workbook.

### 5.11 Course Effectiveness Dashboard

- Satisfaction, attendance, feedback response, and completion trends
- Course and trainer comparison
- Effectiveness ranking
- Department comparison
- Courses below threshold
- Links to relevant sessions and feedback summaries

### 5.12 Risk Dashboard

- Overdue mandatory training
- New employees behind schedule
- Low attendance
- Missing feedback
- Departments below target
- Sessions requiring intervention
- Severity, owner, due date, and recommended next action
- Department-tree filtering and drill-down

## 6. Component architecture

### Foundation

`AppShell`, `SidebarNavigation`, `TopBar`, `RoleScopeIndicator`, `DepartmentScopePicker`, `GlobalCreateMenu`, `PageHeader`, `Breadcrumbs`, `FilterBar`, `EmptyState`, `StatusBadge`, and `ConfirmDialog`.

### Hierarchy

`DepartmentTree`, `DepartmentTreeNode`, `DepartmentBreadcrumb`, `DepartmentScopeSummary`, `ChildDepartmentComparison`, and `ScopedEmployeePreview`.

### Dashboards

`ManagementInsightBanner`, `TrainingHealthScore`, `KpiMetricCard`, `TargetProgress`, `TrendChart`, `DepartmentRanking`, `CourseEffectivenessChart`, `RiskSummary`, and `ActionPriorityList`.

### Calendar and sessions

`CalendarToolbar`, `CalendarViewSwitcher`, `CalendarFilterPanel`, `MonthCalendar`, `WeekCalendar`, `DayCalendar`, `CalendarEventCard`, `CreateSessionPanel`, `SessionQuickView`, `SessionOverview`, `AttendanceRoster`, `FeedbackSummary`, `QrActionCard`, and `QrPreviewDialog`.

### People

`PeopleToolbar`, `PeopleFilterPanel`, `EmployeeTable`, `EmployeeCard`, `EmployeeIdentity`, `CompletionIndicator`, `RiskTag`, `EmployeeProfilePanel`, `EmployeeTrainingHistory`, `BatchActionBar`, `AssignTrainingPanel`, and `MakeUpTrainingPanel`.

### KPI targets

`KpiCatalog`, `KpiTargetCard`, `KpiTargetEditor`, `TargetPeriodTabs`, `DepartmentOverrideTree`, `ThresholdEditor`, `WeightDistribution`, and `HealthScorePreview`.

### Organization and permissions

`DepartmentTreeEditor`, `PositionManager`, `TrainerAssignmentMatrix`, `RoleList`, `PermissionScopePanel`, `ScopePreview`, and `InvitationPanel`.

### Import workflow

`ImportStepper`, `UploadDropzone`, `DetectedSheets`, `FieldMappingTable`, `ImportPreview`, `ImportIssueSummary`, `DuplicateResolver`, `UnmatchedValueResolver`, `ImportConfirmation`, and `ImportHistory`.

### Mobile QR

`MobileSessionHeader`, `DepartmentStepSelector`, `EmployeeSearch`, `EmployeeResultCard`, `IdentityConfirmation`, `RatingInput`, `FeedbackForm`, and `MobileSuccessState`.

## 7. Mock data model

The local data layer contains `HotelProperty`, `Department`, `Position`, `Employee`, `Course`, `Trainer`, `TrainingPlan`, `TrainingSession`, `Attendance`, `Feedback`, `TrainingAssignment`, `KpiDefinition`, `KpiTargetOverride`, `KpiResult`, `RiskItem`, `Role`, `UserAccount`, and `ImportJob` entities.

Key modeling rules:

- Departments store `parentId`, `path`, `level`, bilingual names, and active state.
- KPI results are keyed by KPI, period, and department scope.
- KPI targets separate hotel defaults from department overrides.
- Parent KPI actuals aggregate descendant results using the correct formula, not simple averaging where inappropriate.
- Employees carry Chinese name, English name, natural employee ID, department, position, employment status, new-employee flag, completion state, and risks.
- Training sessions reference department branches or explicit audiences.
- Attendance and feedback connect employees to sessions.
- Roles carry allowed actions and department scopes.
- Import jobs include detected sheets, mappings, row outcomes, issues, and history.

The prototype models one hotel, 7 top-level departments, 20–25 nested departments, 80–120 employees, 12 courses, 18–24 sessions in a representative month, 8 KPI definitions, and deliberately varied results and risks. Visible identifiers use natural formats such as `FO-0186`; UUIDs and database fields never appear.

## 8. KPI calculation and target presentation

Each KPI definition includes a formula description and a calculation type. Mock results are precomputed consistently for each period and department scope.

For higher-is-better metrics:

- Completion percentage = actual / target × 100%
- Gap = actual − target

For any future lower-is-better metric, display logic must reverse the interpretation without changing the business label.

Training Health Score is a weighted score across active KPI completion values, capped where appropriate to avoid a single overperforming metric masking critical underperformance. Thresholds determine healthy, warning, and critical states. The prototype clearly labels the selected month, quarter, or year and compares it with the immediately preceding equivalent period.

## 9. Visual design system

### Direction: Contemporary Hotel Intelligence

- Warm ivory canvas: `#F6F3ED`
- Premium white surface: `#FFFEFB`
- Ink blue: `#183247`
- Deep slate: `#304958`
- Champagne: `#C9A96E`
- Soft teal: `#4F8B86`
- Positive: `#4F816E`
- Warning: `#C78A45`
- Critical: `#B85C58`
- Secondary text: `#71808A`
- Border: `#DEDCD5`

The layout uses deliberate whitespace, fine borders, restrained shadows, tailored corner radii, strong KPI typography, elegant charts, and bilingual hierarchy. Champagne is reserved for selection and executive emphasis; teal communicates healthy operation; coral communicates risk.

Charts use refined lines, bars, progress tracks, ranked lists, and heatmaps. They avoid decorative 3D effects, excessive gradients, childish gamification, or generic chart-grid density.

Chinese typography receives priority in sizing and line height. English secondary labels are smaller and quieter. Numerals use tabular alignment. Session statuses always use both labels and color.

## 10. Interaction and state requirements

- All major prototype actions provide visible feedback.
- Navigation preserves the active department and reporting period where relevant.
- Forms have populated, empty, validation, confirmation, and success examples.
- Loading may be simulated briefly only where it makes the prototype interaction credible.
- Permission-restricted actions are hidden or clearly disabled with an explanation.
- Empty states explain why the view is empty and provide a next action.
- Mobile touch targets, keyboard focus, contrast, and accessible names are included.
- The prototype is responsive across desktop, tablet, and mobile QR views.

## 11. Milestone 1 implementation sequence

1. Initialize a new Sites project and establish design tokens, bilingual content rules, mock-data boundaries, routes, and application shell.
2. Build the shared department hierarchy and scope mechanism first because every major module depends on it.
3. Build Executive, Organization, Course Effectiveness, and Risk dashboards from the shared hierarchy and KPI data.
4. Build the full calendar, operational session creation, session detail, and QR action flows.
5. Build the mobile department-tree check-in and feedback journeys.
6. Build People Center, employee profiles, batch actions, assignment, and make-up training flows.
7. Build KPI Target Center with hotel targets, inherited department overrides, thresholds, weights, and score preview.
8. Build Organization & Permissions with mock role switching and scope preview.
9. Build the complete mock Import Center workflow and history.
10. Verify bilingual consistency, hierarchy scoping, calculations, realistic interactions, responsive behavior, accessibility, and visual finish before publishing the prototype.

## 12. Acceptance criteria

Milestone 1 is accepted when:

- All specified modules and contextual pages are navigable.
- Chinese is the primary UI language throughout, with useful secondary English labels.
- The department hierarchy consistently controls dashboards, filters, calendar scope, People Center, QR check-in, permissions, KPI overrides, risks, and reports.
- Users can drill from top-level department to sub-department to leaf department to employee list.
- Every Executive Dashboard KPI card shows actual, target, completion, gap, period, and prior-period trend.
- KPI Target Center supports hotel targets and department overrides for month, quarter, and year.
- Calendar date selection opens a credible session-creation flow and session details expose QR actions.
- Mobile check-in follows the required department-tree sequence and displays complete employee identity and status.
- People Center covers routine employee maintenance and training operations without relying on Excel.
- Import Center presents every required workflow stage and representative error state.
- The interface is visually premium, polished, responsive, and free of exposed technical identifiers.
- All data remains local mock data; no database, real authentication, real Excel parsing, or production integrations are introduced.

## 13. Explicitly deferred scope

- Persistent database and backend APIs
- Real authentication, authorization enforcement, and account recovery
- Actual Excel file reading or import execution
- Email, SMS, WeChat, or enterprise messaging delivery
- Production QR token security and expiry enforcement
- HRIS, payroll, or identity-provider integration
- Multi-property administration beyond a visual mock selector
- Formal report file generation

