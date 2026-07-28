# E0-B migration rehearsal evidence register template

**Release commit:** `[SHA]`  
**Rehearsal date:** `[UTC date]`  
**Environment:** `disposable local Supabase only`  
**Owner:** `[name or role]`

| Item | Status | Redacted evidence | Owner / disposition |
|---|---|---|---|
| Release manifest and environment boundary | Verified / Not performed / Blocked / Accepted exception | commit and focused-test total | |
| Empty local reset | Verified / Not performed / Blocked / Accepted exception | local-only command category, timestamp | |
| Migration count, order, and checksums | Verified / Not performed / Blocked / Accepted exception | aggregate count and manifest comparison | |
| Local migration history | Verified / Not performed / Blocked / Accepted exception | local-only history match | |
| Empty-lane account/employee/fact counts | Verified / Not performed / Blocked / Accepted exception | aggregate zero counts only | |
| D0–D4 focused pgTAP | Verified / Not performed / Blocked / Accepted exception | file/assertion total | |
| Full pgTAP | Verified / Not performed / Blocked / Accepted exception | file/assertion total | |
| RLS/RPC/Storage | Verified / Not performed / Blocked / Accepted exception | named local security checks | |
| Failure stop and recovery | Verified / Not performed / Blocked / Accepted exception | sanitized stop reason and clean-reset outcome | |
| Application/build verification | Verified / Not performed / Blocked / Accepted exception | test/build/render total | |
| Lint/advisor result | Verified / Not performed / Blocked / Accepted exception | sanitized finding and decision | |
| Cleanup | Verified / Not performed / Blocked / Accepted exception | final no-seed aggregate counts and stopped stack | |

No real hotel identity, employee, account, QR token, or training fact belongs in this register. No Preview or Production connection is allowed. Any item not run must remain **Not performed**, not inferred from a local result.

