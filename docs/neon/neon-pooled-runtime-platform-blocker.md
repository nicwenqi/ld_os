# Neon pooled runtime platform blocker

Status: **NEON_POOLED_RUNTIME_PLATFORM_BLOCKED**.

This is intentionally separate from the Supabase exit gate.

## Approved non-production target

- Project: `withered-bar-40598816`
- Branch: `br-wispy-flower-avd4hssa`
- Endpoint: `ep-lingering-pine-avbdti90`
- Database: `neondb`
- Runtime role: `hotel_ld_application`
- Required pooled hostname label: `ep-lingering-pine-avbdti90-pooler`

The runtime connection must use the Neon pooled hostname, PostgreSQL TLS, the application
role, and `neondb`. Direct bootstrap/runtime substitution is forbidden.

## Recorded evidence

The control plane produced the required pooled hostname label, but the endpoint reported
`pooler_enabled=false`. Bounded pooled connection attempts have produced timeout and
`ECONNRESET` failures before a runtime query/matrix could complete. Source, dry-run, apply,
and catalog checks had already passed; this is neither an RLS, ACL, schema, nor authorization
failure.

## Rerun

When Neon enables pooling for this endpoint, inject only the approved pooled
`hotel_ld_application` connection in the protected operator environment and run:

```sh
node scripts/neon/validate-neon-pooled-runtime.mjs live
```

The validator rejects direct endpoint hostnames, non-application roles, wrong database,
non-TLS connections, and wrong endpoint identity. It returns `BLOCKED` for platform-level
connection failures and never replaces the pooled connection with a direct one.
