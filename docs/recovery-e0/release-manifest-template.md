# E0-A release manifest template

Copy this template for a single proposed release. Replace bracketed placeholders with redacted evidence references only. Do not include credentials, personal data, raw workbooks, tokens, browser sessions, or real hotel records.

## Release identity

<!-- recovery-e0-control: application-sha -->

- Application SHA: `[commit SHA]`

<!-- recovery-e0-control: branch -->

- Branch: `[branch name]`

<!-- recovery-e0-control: build-identifier -->

- Build identifier: `[local or non-production build identifier]`

<!-- recovery-e0-control: named-owners -->

- Named owners: `[release owner]`; `[evidence reviewer]`; `[approval-record custodian]`

## Compatibility and migration inventory

<!-- recovery-e0-control: compatibility-declaration -->

- Compatibility declaration: `[state the D0-D4-compatible release scope and any verified compatibility conditions]`

<!-- recovery-e0-control: ordered-migration-filenames-and-checksums -->

| Order | Migration filename | Checksum |
| --- | --- | --- |
| `[1]` | `[YYYYMMDDHHMMSS_description.sql]` | `[checksum]` |

## Non-production verification evidence

<!-- recovery-e0-control: local-reset-evidence -->

- Local reset evidence: `[command result or evidence reference]`

<!-- recovery-e0-control: pgtap-evidence -->

- pgTAP evidence: `[test result or evidence reference]`

<!-- recovery-e0-control: application-evidence -->

- Application evidence: `[focused application-test result or evidence reference]`

<!-- recovery-e0-control: build-evidence -->

- Build evidence: `[local or non-production build result or evidence reference]`

<!-- recovery-e0-control: browser-evidence -->

- Browser evidence: `[redacted local or non-production browser-check reference]`

## Production mode declaration

<!-- recovery-e0-control: production-app-env-production -->

- `APP_ENV=production`

<!-- recovery-e0-control: production-app-data-mode-supabase -->

- `APP_DATA_MODE=supabase`

## Explicitly prohibited

<!-- recovery-e0-control: forbid-db-reset-linked -->

- Do not run `db reset --linked`.

<!-- recovery-e0-control: forbid-include-seed -->

- Do not use `--include-seed`.

<!-- recovery-e0-control: forbid-migration-history-repair -->

- Do not repair migration history.

<!-- recovery-e0-control: forbid-raw-employee-export -->

- Do not export raw employee data.

<!-- recovery-e0-control: forbid-production-test-environment -->

- Do not use Production as a test environment.

## Approval boundary

<!-- recovery-e0-control: manifest-author-no-production-authority -->

The manifest author does not authorize Production work.

<!-- recovery-e0-control: separate-approval-per-production-operation -->

Each Production schema, data, or traffic operation requires its own separate explicit approval record.

## Redaction and declared non-actions

<!-- recovery-e0-control: redaction-statement -->

- Redaction statement: this manifest contains no credentials, personal data, raw workbooks, tokens, browser sessions, or real hotel records.

<!-- recovery-e0-control: not-performed-state -->

- State: **not performed** — Production connection, schema/data/traffic operation, deployment, migration, import, account creation, seed, reset, and data mutation.
