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
| XSS / clickjacking / MIME sniffing | Browser | CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP |
| Misconfigured outbound links (`FEEDBACK_URL=javascript:…`) | Config | Server and client accept only `http(s)` URLs |
| Spoofed collection names (bidi overrides, control characters) | Library | Names are stripped of control, zero-width, and bidi characters and capped at 200 chars |
| Internal details in error responses | API | 500 responses return a generic message plus a request ID; details go to server logs only |
| Torn writes / corruption on crash | Library storage | Atomic write (temp file + rename), serialized mutations, orphaned temp-file cleanup, corrupt files skipped |
| Credentials visible on shared screens | UI | Header, query, and body values that look like credentials are masked until explicitly revealed |
| Leaking secrets when sharing a collection or report | UI / CLI | "Sanitized copy" export and `--sanitize` replace credentials with `{{variables}}`; reports contain masked evidence only |
| Long-lived secrets in a team library | Library | Optional server-side redaction (`LIBRARY_REDACT_SECRETS=true`), retention (`LIBRARY_RETENTION_DAYS`), and caps (`LIBRARY_MAX_ITEMS`, `LIBRARY_MAX_TOTAL_MB`) |
| Running as root in containers | Docker | Image runs as the unprivileged `node` user; compose drops all capabilities and sets `no-new-privileges` |

### Out of scope

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
| Scripts | `pm.*.set("token", "literal")`, literal assignments, provider tokens, `console.log` of credentials |
| Collection variables | Credential-like names or `secret` type with literal values; provider tokens in any variable |
| Saved example responses | Tokens in bodies, `Set-Cookie` sessions, `Authorization` in the original request |
| Anywhere else | Provider formats: AWS, GitHub, GitLab, Slack, Stripe live keys, Google, OpenAI, Anthropic, SendGrid, Twilio, npm, Azure storage keys, JWTs, private key blocks, connection strings with passwords |
| Disabled entries | Headers, query params, form fields and scripts switched off in Postman are still in the export, so they go through the same secret rules (evidence is labelled `(disabled)`) |
| Transport | `http://` / `ws://` to non-local hosts (including a `{{baseUrl}}` that resolves to one), `strictSSL: false` |

Placeholders (`<string>`, `changeme`, `your-api-key`, `demo-…`) and variable references (`{{token}}`, `{{auth-token}}`) are not reported.

## 4. Operator checklist

For any deployment with `LOGGING_MODE=hybrid` or `on`:

- [ ] Put PostScope behind HTTPS (reverse proxy) and set `ENABLE_HSTS=true` once HTTPS-only.
- [ ] Set `BASIC_AUTH_USER` and a long random `BASIC_AUTH_PASSWORD`, or restrict network access to trusted users. The server logs a warning at startup when the library is enabled without authentication.
- [ ] If behind a proxy, set `TRUST_PROXY=true` so rate limits use the real client IP, and add the public origin to `ALLOWED_ORIGINS` if the proxy rewrites `Host`.
- [ ] Choose a retention policy: `LIBRARY_RETENTION_DAYS`, `LIBRARY_MAX_ITEMS`, `LIBRARY_MAX_TOTAL_MB`.
- [ ] Consider `LIBRARY_REDACT_SECRETS=true` so stored copies never contain usable credentials.
- [ ] Consider `LIBRARY_ALLOW_DELETE=false` when the library is an audit record.
- [ ] Mount `/app/data` on a volume writable by uid 1000 and back it up. It contains whatever users uploaded.
- [ ] Monitor `GET /api/health` (returns 503 when storage is not writable).
- [ ] Run `npm run audit:deps` regularly and rebuild the image after dependency updates.

## 5. Reporting a vulnerability

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability) rather than a public issue. Include reproduction steps and the affected version (`/api/config` → `appVersion`).
