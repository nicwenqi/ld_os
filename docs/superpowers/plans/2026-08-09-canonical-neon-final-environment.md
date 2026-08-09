# Canonical Neon Final Environment Implementation Plan

## Objective

Create a self-contained, repeatable PostgreSQL 18 bootstrap for the final
Hotel L&D OS Neon business-data architecture. Preserve the validated E1-E5A
security and domain contracts while excluding Supabase database schemas,
legacy Import authority/state, compatibility bridges, and all seed data.

## Global constraints

- Work only on `codex/canonical-neon-baseline` in its isolated worktree.
- Do not modify `codex/recovery-d1`, Production, Supabase, old Neon children,
  or the failed staging evidence project.
- A new independent Neon PostgreSQL 18 project is the only database target.
- The bootstrap must install on an empty database and be repeatable by
  installing into two empty databases or projects.
- Runtime role is `hotel_ld_application`, must be `NOBYPASSRLS`, must own no
  business object, and must have zero raw business-table privileges.
- Business entrypoints use constrained `SECURITY DEFINER`, fixed
  `search_path`, explicit Actor Context/property authorization, exact execute
  grants, and no `PUBLIC EXECUTE`.
- All tenant/property business tables use RLS and FORCE RLS.
- Actor Context is transaction-local and provider-neutral; no `auth.uid()`,
  `auth.users`, persistent session `SET`, or browser-supplied identity scope.
- No business seed, test identity, historical provenance, Import staging,
  Import commit/revert, `auth`, `storage`, or Supabase compatibility object.
- Follow TDD: source/behavior validation must fail before bootstrap objects
  are added, then pass after implementation.

## Task 1: Manifest and fail-closed source validator

Create a machine-readable canonical object manifest and a connection-safe
validator with `source`, `dry-run`, `apply`, `catalog`, `runtime`, and
`repeatability` modes. Source validation must reject forbidden schemas,
objects, tokens, grants, raw application privileges, non-fixed definer
search paths, missing FORCE RLS, and manifest/bootstrap drift. Record RED and
GREEN evidence. Do not connect to a database in this task.

## Task 2: Canonical E1-E5A bootstrap modules

Build ordered, empty-database modules for roles, Actor Context/authorization,
People, Organization, Position, Employee Write, and security postflight.
Use final E1-E5A domain contracts and entrypoint names required by the current
Neon repositories. Remove legacy preflight/bridge logic and all dependencies
on Import, Supabase auth/storage, and future-domain shell tables. No seed data.
Run source validation and connection-free SQL contract tests.

## Task 3: Independent Neon PG18 validation environment

Create a new independent Neon PostgreSQL 18 project. Verify its project,
branch, endpoint, database, and owner identity without exposing credentials.
Run canonical source, dry-run, apply, catalog, runtime, Actor Context isolation,
and repeatability validation. Use owner/bootstrap only for install and a real
`hotel_ld_application` credential for runtime. Do not touch any existing Neon
project. Write a redacted validation report with exact object/security counts.

## Task 4: Regression, documentation, and final review

Run `npm test` (201/201) and `npm run build`, verify no browser credential or
`pg` client-bundle leakage, verify current repository/API contracts referenced
by the baseline manifest, and document install/rollback/rebuild procedures.
Perform a whole-branch security/spec review and fix all load-bearing findings.
