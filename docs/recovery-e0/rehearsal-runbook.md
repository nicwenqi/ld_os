# E0-B rehearsal evidence protocol

## Purpose

This protocol turns a disposable, local migration rehearsal into reviewable evidence. It does not authorize a Production action, employee baseline, Pilot property initialization, or first training loop.

## Evidence status vocabulary

- **Verified** — a named local-only command or test produced recorded, redacted evidence.
- **Not performed** — intentionally not run because it needs a later approval or is outside E0-B.
- **Blocked** — stopped before completion; record the reason and preserve only redacted diagnostics.
- **Accepted exception** — a named owner accepted a non-blocking issue with rationale; it is not silently passed.

## Required E0-B record

Record the release commit, local target, CLI version, local reset timestamp, migration count, order, and checksums; local migration-history comparison; empty-lane aggregate facts; focused/full pgTAP totals; RLS/RPC/Storage checks; failure stop and recovery; lint/advisor results; test/build result; and cleanup result.

No real hotel identity, employee, account, QR token, or training fact may appear in the evidence. Use aggregate counts, stable migration names, sanitized warning text, and test totals only.

## Two local lanes

1. **Empty migration lane:** start the disposable local stack, then use `db reset --local --no-seed`. Record zero aggregate counts after all migrations apply.
2. **Synthetic security lane:** only after the empty lane is captured, use the repository-owned local synthetic seed to satisfy existing pgTAP fixture prerequisites. The test suite owns transaction fixtures. Finish by returning to the no-seed empty lane and stopping the local stack.

## Stop and recovery record

If a migration, inventory, test, security check, or local reset fails, mark the current step **Blocked**, record the command category and sanitized error, stop the run, reset only the local disposable database, then start a fresh replay. A remediation must never be attempted on Preview or Production.

## Boundary confirmation

No Preview or Production connection is permitted in E0-B. Do not retain browser sessions, CLI credentials, local service keys, raw fixtures, workbooks, or screenshots after the run.
