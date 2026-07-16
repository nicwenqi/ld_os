# Recovery B — Trusted Administration and Activation Design

## Outcome

Recovery B turns the validated hotel foundation into five clear, persistent manager experiences:

1. Hotel settings
2. Official organization and operational units
3. Positions and position families
4. Backend accounts and department scopes
5. Finite hotel activation and readiness review

The application continues to expose only the Hotel L&D Manager and Department Training Responsible Person workspaces. Employees remain business records and never receive accounts automatically.

## Information architecture

- `/settings/hotel` — hotel identity, Logo, and business rules
- `/organization` — official department hierarchy and operational units
- `/positions` — position families, official positions, and applicable departments
- `/accounts` — the two approved backend roles, account status, and department scopes
- `/initialize` — finite activation and readiness review
- `/permissions` — compatibility redirect only; it no longer hosts a dense administration workspace

Department and position mappings remain available inside the employee-data preparation workflow and as secondary maintenance links. They are not permanent high-priority navigation.

## Persistence contract

Every editable administration surface uses the same states:

- 未修改
- 有未保存更改
- 保存中
- 已保存 · HH:mm
- 保存失败，点击重试
- 资料已被其他操作更新，请重新读取

Each save validates input, sends the repository or protected service operation, checks the expected version, persists, re-reads authoritative state, and then reports success. Dirty forms warn before refresh, close, or navigation.

## Organization and positions

The existing arbitrary-depth department tree, closure table, move preview, cycle protection, aliases, operational units, position families, positions, and department assignments are retained.

The user experience separates official structure from source mappings. Normal administration supports:

- create, rename, reorder, move, activate, and deactivate official departments;
- create and edit operational units without treating them as permission scopes;
- create and edit position families;
- create and edit official positions;
- atomically maintain a position's applicable departments.

All mutation operations re-read server state and surface version conflicts.

## Account and scope administration

Account creation and password provisioning stay behind a protected server boundary because Supabase Auth administration must never run in the browser.

The manager sees only business-safe fields:

- display name;
- User ID;
- approved role;
- account status;
- optional employee link status;
- assigned official department scopes;
- descendant inclusion;
- last update and version.

Internal email identities and Auth UUIDs are never returned.

Only these role outcomes are accepted:

- `property_ld_manager` — Hotel L&D Manager
- `department_training_admin` — internal role code presented as Department Training Responsible Person

The system prevents:

- department users from reaching account administration;
- cross-property membership, role, or scope changes;
- inactive departments from becoming scopes;
- one account from holding both approved hotel roles;
- a user from widening their own role or department scope;
- disabling or demoting the final active Hotel L&D Manager.

Ordinary employees are never provisioned automatically. An optional employee link remains separate from account identity.

## Finite activation

Activation is a five-section review rather than a permanent eight-step workflow:

1. 酒店信息与规则
2. 正式部门
3. 管理员账号
4. 员工资料准备
5. 启用复核

The minimum activation gates are:

- valid hotel identity;
- valid required business rules;
- at least one active official department;
- at least one active Hotel L&D Manager.

Positions, employee-file inspection, mappings, and department-responsible assignments remain visible as operational-readiness findings but do not trap the hotel in initialization. After activation, `/initialize` becomes a review page, and ongoing work moves to normal administration.

## Security boundary

- Property managers retain hotel-wide foundation administration.
- Department responsible persons read only their assigned official branches, descendants only when explicitly included, and the minimum ancestor path needed for breadcrumbs.
- Account mutations use constrained transactional database operations invoked by a server-authorized manager.
- Browser clients cannot directly mutate account, membership, role, or scope records.
- All exposed tables retain RLS.
- Local-review repositories are rejected in Production at configuration parsing and repository construction.

## Visual and interaction direction

Recovery B extends the approved Luxury Hotel Operations Console:

- warm ivory canvas and ink-blue structure;
- champagne emphasis for executive hierarchy;
- teal only for verified positive states;
- coral only for actionable failures;
- slate for unavailable, incomplete, or unverified states;
- Chinese-first labels and business language;
- responsive cards and focused editors rather than dense tables;
- dialogs with clear close, cancel, save, validation, and conflict recovery behavior.

Recovery A home pages keep their architecture. The unavailable training judgment becomes quieter, organization confirmation becomes explicit, and mobile foundation facts appear earlier.
