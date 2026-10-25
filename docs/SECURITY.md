# PostScope Security Guide

This document describes PostScope's threat model, the security controls built into the app and server, and a checklist for operators. For deployment mechanics see [DEPLOYMENT.md](DEPLOYMENT.md); for code structure see [ARCHITECTURE.md](ARCHITECTURE.md) and the [technical mindmap](mindmap/TECHNICAL_MINDMAP.md).

---

## 1. What PostScope protects

Postman collections routinely contain live credentials: bearer tokens, API keys, OAuth client secrets, passwords in request bodies, and tokens captured in saved example responses. PostScope's job is to find those leaks, so it handles exactly the data an attacker wants. The design goals are:

1. **Collections stay in the browser by default.** Parsing and auditing run client-side (in a Web Worker). Nothing is uploaded in `LOGGING_MODE=off`.
2. **Shared storage is opt-in and bounded.** `hybrid`/`on` modes store collections on the server only with explicit consent (hybrid) or an explicit operator policy (on).
3. **Secrets are never echoed back in full.** Findings, reports, CLI output, and logs carry masked previews only.
4. **The server is small and hostile-input safe.** Every request is size-limited, validated, rate-limited, and served with a strict browser security policy.

## 2. Threat model

| Threat | Where | Control |
|---|---|---|
| Reading arbitrary files (`/../.env`, encoded `%2e%2e`, backslashes) | Static file server | `resolveStaticPath` decodes once, rejects `..`, dotfiles, NUL, backslashes, and anything resolving outside `dist/` |
| Reading/deleting arbitrary JSON files via the library API (`/api/collections/..%2F..%2Fx`) | Library API | IDs must be server-generated UUIDs (strict regex) before any filesystem call |
| Cross-site request forgery (a malicious page saving/deleting library entries) | Library API | `Content-Type: application/json` required (blocks simple CORS-less POSTs) + `Sec-Fetch-Site` / `Origin` same-origin check |
| Memory exhaustion via huge uploads | Library API | Body read with a hard byte cap (`MAX_COLLECTION_MB`), early 413 on `Content-Length`, `Connection: close` on rejection |
| Slowloris / header floods | HTTP server | `headersTimeout` 20s, `requestTimeout` 120s, `keepAliveTimeout` 5s, `maxHeadersCount` 100 |
| API abuse / scraping | API | Per-IP fixed-window rate limits for reads and writes (429 + `Retry-After`) |
| Unauthorized access to a shared library | Whole app | Optional HTTP Basic auth (`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`), constant-time comparison, lockout after repeated failures |
| Spoofed client IP to dodge rate limits or the sign-in lockout | Whole app | With `TRUST_PROXY=true` the client IP is taken `TRUST_PROXY_HOPS` entries from the right of `X-Forwarded-For`, validated as an IP, and falls back to the socket address; client-supplied left-hand entries are ignored |
| Flooding the failure table to erase lockouts, or distributed password guessing | Whole app | Expired entries are swept first, then the oldest unlocked entries are evicted; locked addresses are never evicted. More than 10x the per-IP limit of failures in 15 minutes triggers a 60 second global back-off during which credentials are not evaluated (429, plain requests still get the 401 challenge) and a warning is logged |
| Version fingerprinting on the public health endpoint | API | `HEALTH_EXPOSE_VERSION=false` removes `version` from `/api/health` |
| XSS / clickjacking / MIME sniffing | Browser | CSP (`script-src 'self'`, `worker-src 'self'`, `img-src 'self' data:`, `frame-ancestors 'none'`, `object-src 'none'`; no `blob:` sources), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP |
| Misconfigured outbound links (`FEEDBACK_URL=javascript:…`) | Config | Server and client accept only `http(s)` URLs |
| Spoofed collection names (bidi overrides, control characters) | Library | Names are stripped of control, zero-width, and bidi characters and capped at 200 chars |
| Internal details in error responses | API | 500 responses return a generic message plus a request ID; details go to server logs only |
| Torn writes / corruption on crash | Library storage | Atomic write (temp file + rename), serialized mutations, orphaned temp-file cleanup, corrupt files skipped |
| Credentials visible on shared screens | UI | Header, query, and body values that look like credentials are masked until explicitly revealed |
| Leaking secrets when sharing a collection or report | UI / CLI | "Sanitized copy" export and `--sanitize` replace credentials with `{{variables}}`; reports contain masked evidence only |
| Stolen data volume, backup or disk image exposes stored collections | Library | Optional AES-256-GCM encryption at rest (`LIBRARY_ENCRYPTION_KEY[_FILE]`) with a random IV per record and the record id as authenticated data; tampered or swapped records are rejected; saving is refused (never plaintext) when the key is invalid; key rotation with `LIBRARY_ENCRYPTION_KEY_PREVIOUS` and `library.js encrypt` |
| No record of who read or changed the shared library | Library | Append-only audit log (`DATA_DIR/audit/library-YYYY-MM.jsonl`) of saves, opens and removals with timestamp, collection id and name, user, IP and request id, never collection content; user identity comes from the SSO proxy through `TRUSTED_USER_HEADER`, only when `TRUST_PROXY=true` |
| Long-lived secrets in a team library | Library | Optional server-side redaction (`LIBRARY_REDACT_SECRETS=true`), retention (`LIBRARY_RETENTION_DAYS`), and caps (`LIBRARY_MAX_ITEMS`, `LIBRARY_MAX_TOTAL_MB`) |
| Running as root in containers | Docker | Image runs as the unprivileged `node` user; compose drops all capabilities and sets `no-new-privileges` |
| Large dependency surface in the runtime image | Docker | The server is compiled to one JavaScript file with no third-party code at run time; the image ships no `node_modules`, no build tools and no TypeScript sources |

### Out of scope

- Suppressions are a governance tool, not a detector: they hide findings only for the occurrences they name, need a written reason, can expire, and stay visible in every report. Review `.postscope.json` and baseline changes in code review like any other security policy change. Baseline files contain rule ids, request ids and evidence locations but never credential values.
- Environment and globals files are analyzed in the browser or CLI only. They are never sent to the team library, so a library record cannot leak them.
- PostScope does not verify whether a detected secret is still valid. Treat every finding as exposed and rotate it.
- Page addresses contain the page, filters, rule ids and, for a selected request, the request id (`folder/name`). They never contain values, evidence or bodies, but request names can appear in browser history, proxy logs and shared links: treat a link as you would the collection's table of contents.
- Basic auth is a gate, not identity management. Use an SSO-aware reverse proxy (see the deployment guide) if you need per-user audit trails.
- Encryption at rest protects the volume and backups, not a running server: anyone who can call the API or read the process environment can still read collections. The key lives where the server can read it, so keep it in a secret store and out of images, compose files committed to git and shell history.
- Rule-based detection has false positives and negatives. Use the rule settings to tune it, not as proof of absence.

## 3. Detection coverage

The audit engine (`src/lib/auditor.ts`, rules in `src/lib/rules.ts`) inspects:

| Location | Examples |
|---|---|
| Headers | `Authorization` / `Proxy-Authorization` (any scheme), `X-API-Key`, `X-Auth-Token`, session cookies, password headers |
| Auth helpers (request, folder, collection; inheritance-aware) | Bearer token, API key value, OAuth1/OAuth2 secrets and tokens, AWS secret key, Digest/NTLM passwords, Hawk, Akamai, JWT, ASAP |
| Bodies | JSON (nested objects and arrays, including unquoted `{{variables}}`), XML/SOAP elements, `key=value` text, urlencoded, form-data, GraphQL variables |
| URLs | Credential query parameters (`api_key`, `token`, `sig`, …), `user:password@host` |
| Scripts | `pm.*.set("token", "literal")`, literal assignments and properties, `Authorization` literals added with `pm.request.headers` or `pm.sendRequest`, bearer literals in `pm.request.auth`, `btoa('user:password')`, provider tokens, `console.log` of credentials |
| Collection variables | Credential-like names or `secret` type with literal values; provider tokens in any variable; the same for folder and request variables |
| Descriptions | Provider tokens and `key: value` credential fragments in collection, folder and request descriptions (replaced with `{{REDACTED}}` in sanitized copies) |
| Environment and globals files | Credential-like names, `secret` typed variables (Postman exports them in clear text) and provider tokens with literal values (`SECRET_IN_ENVIRONMENT`). The sanitized export and the CLI `--sanitize` option write copies with those values emptied |
| Path variables | Credential-like `url.variable` entries such as `:token` |
| Saved example responses | Tokens in bodies, `Set-Cookie` sessions, `Authorization`, query credentials and body secrets in the original request |
| Anywhere else | Provider formats: AWS, GitHub, GitLab, Slack, Stripe live keys, Google, OpenAI, Anthropic, SendGrid, Twilio, npm, Azure storage keys, JWTs, private key blocks, connection strings with passwords, Microsoft Entra ID client secrets, Okta API tokens, HashiCorp Vault tokens, Postman API keys, Atlassian, Shopify, DigitalOcean, Docker Hub, Grafana, Hugging Face, Databricks, PyPI and Square tokens |
| Basic Authorization | The base64 value is decoded; only a literal password is reported, so `Basic` tokens that encode `{{variables}}` are not false positives |
| Credential-named fields | Long random-looking literals (20+ characters, high entropy) in sensitive header, query, form and JSON field names that no other rule recognized (`HIGH_ENTROPY_LITERAL`) |
| Disabled entries | Headers, query params, form fields and scripts switched off in Postman are still in the export, so they go through the same secret rules (evidence is labelled `(disabled)`) |
| OAuth 2.0 and OpenID Connect (`iam-am` pack) | Implicit and password grants, authorization code flows without PKCE or with `plain`, unsafe `redirect_uri` values (http to remote hosts, wildcards, user info, nested URLs), missing `state`, token, introspection and revocation endpoints over http, literal tokens and codes in query strings and fragments (including saved example requests), wildcard and administrative scopes, client secrets in the body. Evidence is masked and the pack runs only when the collection shows identity signals |
| JWTs (`iam-am` pack) | Tokens in headers, auth helpers, query, form and raw bodies, variables and saved examples are decoded in memory (never verified, never sent anywhere, 16 KB limit): `alg: none`, access tokens without `exp` or over 24 hours, personal or privilege claims, ID tokens sent as bearer tokens, expired tokens. Evidence shows masked claims only |
| SAML and sessions (`iam-am` pack) | A `SAMLResponse` that decodes to an assertion in a form field, query, raw body or saved example (decoded in memory, at most 256 KB, never shown), SAML single sign-on, assertion consumer and metadata URLs over http, session cookies saved without `Secure`, `HttpOnly` or `SameSite` (names and flags only, never values), and token requests with no revocation, logout or session termination request |
| SCIM provisioning (`iam-iga` pack) | `/Bulk` requests that delete or run many operations without `failOnErrors`, list calls without `filter`, `count` or `startIndex`, PATCH operations on `roles`, `entitlements`, `groups`, `members` and `active` (a warning when the value is a literal administrative role or group), bodies without `application/scim+json` or the core schema URN. Only operation shapes are reported, never attribute values |
| Identity lifecycle (`iam-iga` pack) | Requests that create, change, disable, delete or revoke identities on SCIM targets, Okta, Entra ID, Keycloak, Auth0 and Saviynt are mapped to joiner, mover and leaver steps. Reported: joiners with no disable step, hard deletes with no earlier disable, disables with no session or token revocation. Only methods, paths and the on or off state of an account are read |
| Governance and personal data (`iam-iga` pack) | Personal data in request bodies and saved examples: email addresses (documentation domains such as `example.com` are skipped), phone numbers, IBANs (mod-97), card numbers (known prefixes and Luhn), national identifiers with a checksum or fixed format (US SSN, French NIR, Spanish DNI and NIE), and dates of birth and employee ids found by field name. Access requests and certifications are checked for approvers who are also the requester and for bulk approvals. Evidence shows the kind, the path and a masked preview. The sanitized export can also remove this data (`--redact-pii`) |
| PAM and secrets vaults (`iam-pam` pack) | Secrets returned by CyberArk, BeyondTrust, Delinea, HashiCorp Vault and the AWS, Azure and Google secret managers and saved in examples, `X-Vault-Token`, `PS-Auth`, CyberArk logon and Delinea bearer tokens stored as literals, Vault root tokens and `sys/generate-root`, retrievals and checkouts without a reason or ticket, checkouts without a check-in, built-in privileged and break-glass account names used as literal logins, and safe, vault policy and permission changes. Secret values are masked in evidence |
| Admin plane (`iam-pam` pack) | Literal top-tier role assignments (Okta `SUPER_ADMIN` and `ORG_ADMIN`, Entra Global Administrator and Privileged Role Administrator, Keycloak `realm-admin`, AWS `AdministratorAccess`, Azure Owner and User Access Administrator), policy and conditional access bodies that turn factors off, set enforcement to none, stop requiring MFA or exclude all users, and requests that create client secrets, API tokens or access keys (a warning when the response is saved). Privileged operations are also listed per platform with danger zone marks |
| Platform profiles (`iam-platform` pack) | Okta, Entra ID, Auth0, Ping Identity, ForgeRock and Keycloak: tenant ids, org domains, realms and environment ids written as literals in three or more requests, preview and production tenants (or several tenant ids) in one collection, and retired or legacy APIs (Azure AD Graph, Entra v1.0 endpoints, Keycloak `/auth` prefix, Okta classic `/api/v1/authn`, Auth0 `/oauth/ro`, `/delegation` and `/tokeninfo`). Identifiers are masked in evidence |
| Governance, PAM and cloud IAM profiles (`iam-platform` pack) | SailPoint, Saviynt, One Identity, Omada, CyberArk, BeyondTrust, Delinea, HashiCorp Vault, AWS IAM and STS, Azure resource IAM and Key Vault, and Google Cloud IAM are recognized with the same tenant, environment and legacy API checks. Legacy versions reported: SailPoint `/cc/api` and `/v2`, CyberArk `PasswordVault/WebServices`, and Vault KV v1 and v2 bodies sent to the other version's path |
| Transport | `http://` / `ws://` to non-local hosts (including a `{{baseUrl}}` that resolves to one), `strictSSL: false` |

Placeholders (`<string>`, `changeme`, `your-api-key`, `demo-…`) and variable references (`{{token}}`, `{{auth-token}}`) are not reported.

## 4. Operator checklist

For any deployment with `LOGGING_MODE=hybrid` or `on`:

- [ ] Put PostScope behind HTTPS (reverse proxy) and set `ENABLE_HSTS=true` once HTTPS-only.
- [ ] Set `BASIC_AUTH_USER` and a long random `BASIC_AUTH_PASSWORD`, or restrict network access to trusted users. The server logs a warning at startup when the library is enabled without authentication.
- [ ] If behind a proxy, set `TRUST_PROXY=true` so rate limits use the real client IP, set `TRUST_PROXY_HOPS` to the number of proxies you control, make sure PostScope is not reachable around the proxy, and add the public origin to `ALLOWED_ORIGINS` if the proxy rewrites `Host`.
- [ ] Set `HEALTH_EXPOSE_VERSION=false` if the health endpoint is reachable from untrusted networks.
- [ ] Choose a retention policy: `LIBRARY_RETENTION_DAYS`, `LIBRARY_MAX_ITEMS`, `LIBRARY_MAX_TOTAL_MB`.
- [ ] Consider `LIBRARY_REDACT_SECRETS=true` so stored copies never contain usable credentials.
- [ ] Consider `LIBRARY_ALLOW_DELETE=false` when the library is an audit record.
- [ ] Mount `/app/data` on a volume writable by uid 1000 and back it up. It contains whatever users uploaded.
- [ ] Monitor `GET /api/health` (returns 503 when storage is not writable).
- [ ] Run `npm run audit:deps` regularly and rebuild the image after dependency updates. The project's own CI fails on high severity advisories in runtime dependencies, runs CodeQL (security-extended queries) on every push and pull request and weekly, and Dependabot proposes npm, GitHub Actions and base image updates every week.

## 5. Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include reproduction steps and the affected version (`/api/config` → `appVersion`).
