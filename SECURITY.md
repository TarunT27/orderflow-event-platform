# Security policy

This repository is a systems demo, not a payment product. It stores no real payment credentials and has no end-user authentication. The `tok_*` values are deterministic scenario selectors.

## Local safeguards

- Zod validation at HTTP boundaries
- Parameterized SQLite statements
- 32 KiB request body cap and API rate limiting
- Operations endpoints disabled with `DEMO_MODE=false`
- Generic client errors and structured server logs
- Local data, environment files, test artifacts, and logs ignored by Git
- Server-calculated prices and integer minor currency units

Before public deployment, add authenticated identities, authorization for every order, administrative RBAC for DLQ actions, CSRF protection if cookie authentication is used, a strict CORS allowlist, HTTPS, audit logs, and a managed secret store.

Report vulnerabilities privately through GitHub Security Advisories. Do not open a public issue containing exploit details or credentials.
