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
| XSS / clickjacking / MIME sniffing | Browser | CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP |
| Misconfigured outbound links (`FEEDBACK_URL=javascript:…`) | Config | Server and client accept only `http(s)` URLs |
| Spoofed collection names (bidi overrides, control characters) | Library | Names are stripped of control, zero-width, and bidi characters and capped at 200 chars |
| Internal details in error responses | API | 500 responses return a generic message plus a request ID; details go to server logs only |
| Torn writes / corruption on crash | Library storage | Atomic write (temp file + rename), serialized mutations, orphaned temp-file cleanup, corrupt files skipped |
| Credentials visible on shared screens | UI | Header, query, and body values that look like credentials are masked until explicitly revealed |
| Leaking secrets when sharing a collection or report | UI / CLI | "Sanitized copy" export and `--sanitize` replace credentials with `{{variables}}`; reports contain masked evidence only |
| Long-lived secrets in a team library | Library | Optional server-side redaction (`LIBRARY_REDACT_SECRETS=true`), retention (`LIBRARY_RETENTION_DAYS`), and caps (`LIBRARY_MAX_ITEMS`, `LIBRARY_MAX_TOTAL_MB`) |
| Running as root in containers | Docker | Image runs as the unprivileged `node` user; compose drops all capabilities and sets `no-new-privileges` |
| Large dependency surface in the runtime image | Docker | The server is compiled to one JavaScript file with no third-party code at run time; the image ships no `node_modules`, no build tools and no TypeScript sources |

### Out of scope

- Suppressions are a governance tool, not a detector: they hide findings only for the occurrences they name, need a written reason, can expire, and stay visible in every report. Review `.postscope.json` and baseline changes in code review like any other security policy change. Baseline files contain rule ids, request ids and evidence locations but never credential values.
- Environment and globals files are analyzed in the browser or CLI only. They are never sent to the team library, so a library record cannot leak them.
- PostScope does not verify whether a detected secret is still valid. Treat every finding as exposed and rotate it.
- Basic auth is a gate, not identity management. Use an SSO-aware reverse proxy if you need per-user audit trails.
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
- [ ] Run `npm run audit:deps` regularly and rebuild the image after dependency updates.

## 5. Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include reproduction steps and the affected version (`/api/config` → `appVersion`).
