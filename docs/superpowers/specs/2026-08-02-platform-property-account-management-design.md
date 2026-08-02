# Platform Property Account Management Design

## Goal

Extend the Platform Admin Console so platform operators can manage the lifecycle and operational health of Hotel L&D Manager accounts for existing Properties, while preserving the separation between the platform plane and the hotel business plane.

## Scope

### In scope

- View existing Property containers and operational status.
- View the bound Hotel L&D Manager account summary for each Property.
- View Property-scoped backend account health metadata.
- Create/invite a Hotel L&D Manager for an existing Property.
- Reset a Hotel L&D Manager password and require a first-login password change.
- Disable or enable a Hotel L&D Manager account.
- Replace a Property Manager while protecting the final active manager invariant.
- Preserve an append-only platform account-management audit trail.
- Keep `/platform/properties/new` exclusively for new Property provisioning.

### Out of scope

- Department Training Responsible Person creation or management.
- Department scope assignment or descendant-scope changes.
- Hotel settings, organization, positions, employees, imports or Storage.
- Courses, Requirements, Plans, Sessions, Attendance, Completion, KPI, Feedback, Forecast, Risk, Health, AI or automation.
- Platform Admin access to hotel workspaces.
- Direct browser access to authorization or business tables.

## Operating model

The platform plane manages Property containers and Hotel L&D Manager account lifecycle. It does not become a hotel administrator. A Platform Admin may see only the minimum Property and account-health metadata needed for operations:

- Property identity: Property ID, code, names, hostname, status and initialization state.
- Account health: display name, User ID, role label, account status, forced-password-change state, last login and last update.
- Lifecycle history: action type, actor, target account, timestamp, outcome and before/after metadata summaries.

It must never return employee records, department data, department scopes, organization mappings, training facts or raw Auth identifiers to the browser.

The hotel plane remains unchanged:

- Hotel L&D Manager manages hotel settings, organization, employees, Department Training Responsible Person accounts and department scopes.
- Department Training Responsible Person operates only inside explicitly assigned department descendants.

## Route and navigation design

### Existing Property flow

`/platform/properties` is the Platform Admin Property index. It lists existing Properties and links to a detail route.

`/platform/properties/[propertyId]` is the existing-Property account console. It contains Property status and Manager account operations only.

### New Property flow

`/platform/properties/new` remains the only new-Property flow. Its copy and actions must explicitly describe new hotel onboarding and must not be reused as an existing-Property account-management screen.

### Return and denial behavior

- Platform routes require the platform HttpOnly session and active `platform_admin` membership.
- A hotel session, Department Responsible Person session, anonymous request or stale platform session receives a denial or platform-login redirect.
- Platform pages contain return links to the Property index and Platform logout; no link enters `/`, `/department` or any hotel workspace.

## Authorization boundary

Every Platform API follows:

```text
HttpOnly platform session
→ Supabase Auth verification
→ active platform_admin membership check
→ narrow platform RPC
→ metadata projection
```

The browser never supplies the actor, tenant, Property ownership or role authority. `auth.uid()` is the only actor identity accepted by the database boundary.

Each new RPC is `SECURITY DEFINER` only because the platform actor has no direct table-read or table-write authority. It must use an empty fixed `search_path`, explicit schema qualification, strict input validation, and explicit `EXECUTE` grants to `authenticated` only. The first statement must enforce the active platform-provisioner assertion. No new `service_role` table grants are allowed.

The RPCs may read or mutate only:

- `properties`, `property_domains`, `property_settings` readiness fields;
- `profiles` display name and activity fields;
- `tenant_memberships`, `property_memberships` status fields;
- approved `property_ld_manager` role assignments;
- `user_accounts` account lifecycle fields;
- the platform account-management audit table.

No RPC may select or mutate employees, import staging, Storage, departments, scopes or D1-D4 fact tables.

## Domain operations

### Property overview

`platform_list_properties()` returns a stable JSON projection of active and inactive Property containers, primary active hostnames, readiness state and aggregated Manager health. It omits tenant-private business data and all employee/training facts.

### Property account list

`platform_list_property_manager_accounts(p_property_id)` returns only approved Hotel L&D Manager accounts for the selected Property. It returns account IDs, display names, User IDs, status, password-change requirement, last login, version and timestamps. It does not return Auth UUIDs, internal technical emails, employee IDs or department scopes.

### Create or invite Manager

The server validates the display name, User ID and temporary password, creates an internal Auth identity using `createServerAdminClient()`, and then calls `platform_create_property_manager_account(...)` using the authenticated platform actor token. The RPC atomically creates or restores the linked profile, active tenant/property memberships, `property_ld_manager` role assignment and `user_accounts` row with `must_change_password = true`.

If the RPC fails, the server deletes only the newly created Auth identity. Existing Properties and accounts are not changed. Existing account/User ID conflicts are rejected before any durable hotel-account linkage.

### Reset Manager password

The server requests a version-checked reset preparation RPC. The RPC locks the account, verifies that the target is a Manager in the selected Property, sets `must_change_password = true`, clears login lock counters and appends a reset-request audit event. The server then updates the Auth password. A success or failure audit event is appended afterward; the password itself is never recorded.

The current Platform Admin cannot reset a Department Responsible Person because the target role is rejected by the RPC.

### Enable or disable Manager

`platform_set_property_manager_status(...)` uses `account_id + expected_version`, validates `active | suspended | disabled`, and appends the before/after status. Existing final-active-manager triggers and a transaction lock protect the last active Hotel L&D Manager. The current Manager identity may be managed by Platform Admin; self-edit restrictions continue to apply to hotel-plane operations, not to platform provisioning authority.

### Replace Property Manager

Replacement is an explicit two-person-safe operation:

1. Create and validate the new internal Auth identity server-side.
2. Call one transactional `platform_replace_property_manager(...)` RPC with the new identity and the existing account ID.
3. The RPC creates the new Manager linkage, keeps it active, then disables the old Manager in the same transaction. Because the new account exists first, the final-manager guard cannot leave the Property without an active Manager.
4. On RPC failure, delete only the new Auth identity and leave the old Manager unchanged.

The old account remains in history as disabled; its role and account lineage are not overwritten. The new Manager starts with `must_change_password = true`.

## Audit model

Add an append-only `platform_account_management_events` table. Each event includes:

- event ID and event type;
- tenant and Property IDs;
- target account ID and target Auth identity ID where needed internally;
- platform actor ID;
- request hash/idempotency key;
- outcome (`requested`, `succeeded`, `failed`);
- non-secret before/after metadata;
- error code/message category for failed operations;
- occurred timestamp.

The browser receives a business-safe projection and never receives internal Auth identifiers, passwords, password hashes, raw emails or database error details. Update and delete are blocked by an append-only trigger. Every mutation uses a request ID and Property/account advisory lock to make retries and stale submissions safe.

## Concurrency and lifecycle rules

- Account mutations require `expected_version` for existing accounts.
- Stale versions return HTTP 409 and reload guidance.
- A disabled or suspended Manager cannot authenticate through the hotel login chain because account status remains authoritative.
- A Property cannot be left without an active Hotel L&D Manager.
- Creating a second Manager is allowed before disabling the previous one.
- Replacing a Manager does not change employees, department scope data or historical training facts.
- No action changes `Employee Fact Version` or any D0-D4 immutable fact.

## Application structure

### Server

- `app/services/platform-property-accounts.ts`: business-safe types, validation and client request helpers.
- `app/api/platform/properties/route.ts`: existing new-Property flow remains isolated.
- `app/api/platform/properties/index/route.ts`: Property overview projection.
- `app/api/platform/properties/[propertyId]/accounts/route.ts`: account list and lifecycle operations.
- `app/services/platform-authorization.ts`: shared platform actor guard remains the only platform session entry point.

### Client

- `app/platform/properties/page.tsx`: calm Property index with status and Manager health.
- `app/platform/properties/[propertyId]/page.tsx`: account-health and Manager lifecycle console.
- `app/platform/platform.css`: reuse the existing premium platform visual language, 44px controls, mobile-safe layout and explicit unavailable/error states.

All platform UI actions either open a real confirmation form, call a real API, or are disabled with a business explanation. Passwords are entered only in transient fields and are never rendered after submission.

## Migration impact

One additive migration is expected:

- create the append-only platform account-management audit table and trigger;
- create the narrow platform list/create/reset/status/replace RPCs;
- revoke any accidental public/anonymous execution and grant only authenticated execution;
- do not alter D0-D4 tables, columns, constraints or fact semantics;
- do not grant `service_role` table access;
- preserve the existing `provision_initial_property_and_manager` RPC unchanged for new Properties.

The migration is local/non-production until separately reviewed. Rollback is a forward correction: disable the new RPC execution grants and route flags, preserve audit history, and retain existing Property/account records. No Production migration is applied as part of this design step.

## Error and security behavior

- Missing platform session: 401 and redirect to `/platform/login`.
- Non-platform identity: 403 without Property or account metadata.
- Unknown Property: 404 without cross-Property existence leakage.
- Invalid role target, scope input or account status: 422 business-readable validation error.
- Stale account version: 409 with reload guidance.
- Final Manager removal: 409/422 with explanation that another active Manager must exist first.
- Auth creation failure: no database account linkage; no Property mutation.
- Auth password update failure: account remains forced-change and a failed audit event is retained.

## Acceptance criteria

1. Platform Admin can open `/platform/properties` and see existing Property status and Manager health.
2. Platform Admin can open an existing Property detail page and see only allowed account metadata.
3. Platform Admin can create a Hotel L&D Manager without creating employees, scopes or training facts.
4. Platform Admin can reset a Manager password without seeing or persisting the password.
5. Platform Admin can disable and enable a Manager using optimistic concurrency.
6. Platform Admin can replace a Manager atomically and the old account remains auditable.
7. The final active Manager cannot be disabled or replaced without an active successor.
8. Department Responsible Person creation and scope management remain hotel-plane-only.
9. Platform identity cannot access hotel workspace routes or D0-D4 data.
10. Anonymous and hotel identities cannot call Platform RPCs or view Property account metadata.
11. `/platform/properties/new` remains exclusively a new-Property provisioning flow.
12. Focused security tests, full pgTAP, application tests and production build pass locally.
13. No Production data, schema, accounts, DNS or environment variables are changed during implementation.
