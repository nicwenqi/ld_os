# Auth / Authorization Split Design

## Goal

Keep Supabase strictly as the Authentication provider and make canonical Neon
the only authority for account resolution, profile, tenant/property membership,
effective role, department scope, and property context.

## Scope and constraints

- Supabase remains responsible only for password sign-in, token validation,
  refresh, and optional Auth Admin user lifecycle operations.
- Neon remains responsible for every business authorization fact.
- Browser code continues to use same-origin application APIs only; it receives
  neither a Supabase business-data client nor a Neon credential.
- The existing Actor Context model, application role, raw-table privilege
  boundary, RLS policies, and Production policy are unchanged.
- No migration of old Supabase data, Auth provider change, Storage provider
  change, or Production change is included.

## Chosen architecture

### 1. Pre-auth login identity lookup

The login page accepts a hotel login ID, while Supabase password sign-in needs
an email. A constrained Neon entrypoint,
`resolve_neon_login_identity(p_hostname text, p_login_id text)`, resolves an
active property domain and active Neon account to the internal email and Auth
user ID. It is called only by server code through a short, actor-free
application-role transaction. It returns no response to the browser.

The server then calls Supabase `signInWithPassword` and requires the returned
Auth user ID to exactly match the Neon lookup. Every client-visible failure is
the existing generic login failure, preventing account enumeration.

### 2. Actor-scoped authorization session

After Supabase `getUser` or refresh establishes a verified Auth user ID, the
server resolves the trusted hostname to a Neon property in the existing
transaction-scoped Actor Context. A constrained entrypoint,
`read_neon_authorization_session(p_hostname text)`, returns only the
authoritative session projection:

- active account/profile facts;
- active tenant and property membership;
- property context;
- effective role (`property_ld_manager`, scoped department administrator, or
  unauthorized);
- active department scopes and breadcrumbs;
- password-change state.

It requires the Auth user ID and property ID already installed in Actor
Context, validates hostname/property alignment, uses a fixed empty
`search_path`, revokes `PUBLIC` execution, and grants only the exact signature
to `hotel_ld_application`. It writes the existing read audit surface. No raw
table access is granted to the runtime role and no RLS policy is widened.

An active Auth identity that lacks an active Neon account or membership is
returned as the existing unauthorized session shape. A mapped active account
without an eligible role remains authenticated but unauthorized, preserving
current application behavior.

### 3. Server boundaries

`resolveRequestAuthIdentity()` remains the only Supabase Auth token/refresh
boundary. `resolveAccountForLogin()` becomes:

```
login ID + hostname → Neon pre-auth lookup → Supabase signIn → exact Auth ID check
→ Neon Actor Context → Neon authorization session
```

`resolveAuthenticatedRequest()` derives its session from the Neon projection.
`requirePropertyManager()` consumes the private tenant/property facts produced
by that projection instead of querying Supabase `properties`.

The session route exposes only the existing browser-safe `AuthSession` shape;
any tenant ID needed by server authorization stays server-only.

### 4. Explicitly excluded paths

The legacy Supabase repositories, explicit fallback registry, old Import
handler, and Storage adapter are not removed in this task. They remain
separate exit-work items. The following current Supabase business operations
are removed from the active Auth/bootstrap path:

- account/profile/property-domain lookup;
- membership, role, trainer-scope, and department lookup;
- manager property validation;
- Supabase business reads in `/api/auth/session` through its service chain.

Account administration and password-change business flags are recorded as the
next Auth/Authorization split slice: Auth Admin may remain for credential
changes, but their Supabase business-table operations must later move to Neon.

## Error and security behavior

- Neon authorization failure is explicit; it never falls back to Supabase
  business data.
- Supabase Auth failures remain generic at login and are not transformed into
  authorization grants.
- A hostname/property mismatch, inactive membership, or cross-property account
  cannot establish Actor Context for the requested property.
- Pooled connections must be verified clear before and after pre-auth and
  actor-scoped transactions.

## Validation

Connection-free TDD proves:

1. login calls only Supabase Auth and rejects an Auth ID mismatch;
2. manager and department-admin sessions are derived from Neon projections;
3. refresh uses Supabase Auth only and then re-resolves Neon authority;
4. cross-property and inactive membership states fail closed;
5. source gates reject Supabase `.from()` / business `.rpc()` from the active
   Auth/session path;
6. browser artifacts retain no Supabase business-data client or Neon
   credential.

Child validation then covers canonical migration source → dry-run → apply →
catalog and pooled runtime Actor Context cleanup/reuse with real Auth session.
