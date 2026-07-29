# Recovery E0-C0 — Security Boundary Migration Plan

**Status:** Approved design, implementation in progress; local-only

## Scope

C0 creates no hotel Property, manager account, employee, workbook, Course,
Requirement, Plan, Session, Attendance, or Completion fact. It changes only
platform-versus-hotel authorization and adds an append-only platform
provisioning audit boundary.

## Affected authorization objects

### New objects

- Private helpers: `is_platform_provisioner()` and
  `assert_platform_provisioner()`.
- Public, narrow RPC: `provision_initial_property_and_manager(...)`.
- Append-only `platform_provisioning_events` audit relation.

### Existing helpers to tighten

- `can_manage_property`
- `can_read_property_organization`
- `can_manage_user_account`
- `can_read_profile`
- `can_view_role`
- `can_read_role_assignment`
- `can_grant_role`
- `can_read_trainer_scope`
- `can_manage_property_brand_object`

### Existing tables and policies to reassert

- Platform/container relations: `tenants`, `properties`, `property_domains`,
  `tenant_memberships`, `property_memberships`.
- Hotel administration: `property_settings`, `property_initialization_steps`,
  `departments`, aliases, operational units, position families, positions,
  position-department assignments, `profiles`, `user_accounts`,
  `role_assignments`, `trainer_scopes`, and `property_brand_assets`.
- Storage: `property-brand-assets` is manager-only; private
  `property-import-files` remains manager-only.

## Explicit non-impact

D0 Employee Fact Version, D1 Requirement Version, D2 Plan/Session Revision,
D3 Attendance, and D4 Completion Evidence schemas, immutable references and
their RPC semantics are unchanged. C0 only removes the ability for a platform
membership or tenant-admin role to enter their hotel authorization path.

## Authorization model after C0

```text
Platform plane
active platform_admin
  -> narrow provisioning RPC only

Hotel plane
active account + active tenant membership + active property membership
+ active hotel role + department scope/descendants where applicable
  -> hotel administration and D0-D4 operations
```

The provisioning RPC uses a fixed Hotel L&D Manager role and cannot receive a
role code, department scope, employee payload, organization payload, or
training payload from its caller.

## Roll-forward and rollback strategy

This is a privilege-tightening migration. It must be applied only after a
clean local reset and focused attack tests pass.

- **Rollback default:** do not restore the old broad policies. If a legitimate
  provisioning defect is found, halt provisioning and add a reviewed,
  narrowly scoped forward-correction migration.
- **No fact rollback:** no D0-D4 fact row or immutable version is touched.
- **Atomicity:** a failed provisioning RPC rolls back its database writes and
  audit event together. Auth-user creation remains outside this C0 migration
  and is not implemented in C0.

## Verification gates

1. platform-only actor is denied all hotel administration, employee/import
   data, Storage, and D1-D4 access;
2. tenant-admin has no implicit hotel-business authority;
3. Hotel L&D Manager remains authorized for existing administration and
   D0-D4 flows;
4. Department Training Responsible Person remains constrained to explicit
   department scope;
5. all new functions have fixed search paths, no `PUBLIC` execution, and
   append-only audit evidence;
6. local clean reset, focused pgTAP, full pgTAP, application tests, build,
   and synthetic browser checks pass before Review Stop C0.
