# PostScope Roadmap

> **Audience:** the agent or engineer implementing the next releases, plus reviewers who want to know what is coming and why.
> **Baseline:** `Update V0.1.24` (commit `e97a99c`, 2026-10-08). Every item below was derived from a read of the code and docs at that commit.
> **Status:** in progress. Shipped releases get their commit hash in the `Commit` column of section 2; the plan text below is kept as written for history.

---

## 0. How to use this roadmap

### 0.1 Commit and version conventions

The repository history uses one commit per release. Keep that format exactly:

```text
Update V0.1.25

- Short past-tense bullet describing a user-visible or operator-visible change
- One bullet per change, no trailing period
```

Rules for every commit in this file:

| Rule | Detail |
|---|---|
| One version per commit | The title is always `Update V<major>.<minor>.<patch>`. Bullets follow the existing tone: `Added ...`, `Fixed ...`, `Security fixes ...`, `Enhanced ...`, `Updated ...`. |
| Tag | Create an annotated tag on the commit: `git tag -a v0.1.25 -m "Update V0.1.25"`. Tags start with V0.1.25 (no tags exist before it). |
| Version source | `package.json` `version`, `Dockerfile` `ARG APP_VERSION`, and the `compose.yaml` default must match the commit version (set up in V0.1.25). |
| Changelog | Append the same bullets to `CHANGELOG.md` under the version heading (file created in V0.1.25). |
| Definition of done | `npm test`, `npm run build`, and `npm run scan -- public/samples/default.postman_collection.json --fail-on none` pass. New rules have positive and false-positive tests. Docs and mindmaps touched by the behavior are updated in the same commit. |
| Style | Follow `docs/VISUAL_STYLE.md`: no em dash character anywhere, no emoji in UI or reports, sentence case. |
| Secrets in fixtures | Never commit realistic provider tokens. Build fake tokens at runtime in `tests/fixtures.ts` (the existing `FAKE` helper pattern) so GitHub push protection and secret scanners do not trip. Sample collections must use obviously fake values that still exercise the rule. |
| Stability | `Finding.id === Finding.ruleId`, request ids (`folder/path/name#n`), and existing rule titles are public contracts (SARIF fingerprints, saved preferences). Do not rename them; add new rules instead. |

### 0.2 Change types used below

| Type | Meaning |
|---|---|
| Bug | Wrong result, false negative, false positive, or broken behavior in shipped code |
| Security | Fix or hardening that changes the attack surface of the server, the browser app, or the data PostScope produces |
| Feature | New capability |
| Enhancement | Improvement of an existing capability |
| Docs | Documentation only |
| Chore | Tooling, build, dependencies, release plumbing |

### 0.3 Tracks and execution order

| Track | Versions | Theme |
|---|---|---|
| **A: Core platform** | V0.1.25 to V0.1.45 | Fixes, detection coverage, CI and reporting, platform hardening, UX, engineering quality |
| **B: IAM collections** | V0.2.0 to V0.2.15 | Analysis of Postman collections used for Identity and Access Management platforms: AM, IGA, PAM, and platform profiles |

- Implement Track A milestone **A1 (V0.1.25 to V0.1.32) first**: those are correctness and security fixes and several Track B rules build on them.
- Track B depends on V0.1.26, V0.1.28, V0.1.33, V0.1.34 and V0.1.36 (see each entry). The rest of Track A can be completed before V0.2.0, which is the recommended order, so version numbers stay linear.
- If priorities change and Track B must start early, keep numbering linear by merge order (never reuse a version) and update the tables in this file in the same commit.

---

## 1. Baseline snapshot (V0.1.24)

| Area | State |
|---|---|
| Engine (`src/lib`) | Parser with auth inheritance, 27 rules in `rules.ts`, 16 provider secret patterns, penalty scorer, repair engine (15 fix kinds), redaction, JSON/SARIF/Markdown reports |
| Browser app | React 18 + Vite 6, Web Worker analysis, pages: Overview, Requests, Security, Hygiene, Repair, Score; rule settings; export menu |
| Server (`server/`) | Static hosting, `/api/config`, `/api/health`, team library with atomic writes, dedupe, quotas, optional redaction, Basic auth, rate limits, CSP |
| CLI | `npm run scan` with text/json/sarif/markdown, `--fail-on`, `--min-score`, `--sanitize` |
| Tests | `node:test` suites for parser, auditor, secrets, repair, redaction/reports, server, library, CLI |
| CI | Node 20 and 22: test, build, CLI smoke scan, dependency audit (non-blocking) |
| Docs | README, ARCHITECTURE, SECURITY, DEPLOYMENT, DESIGN_SYSTEM, VISUAL_STYLE, functional and technical mindmaps |

### 1.1 Issues found during the analysis

These are the concrete defects and gaps that drive milestone A1 and A2. Line numbers refer to the V0.1.24 tree.

| # | Type | Where | Problem | Planned in |
|---|---|---|---|---|
| F1 | Chore, Bug | `package.json`, `Dockerfile`, `compose.yaml`, `cli/postscope.ts:55` | Package version is `0.0.1` while releases are at V0.1.24, so `/api/config`, `/api/health`, reports and the CLI all report the wrong version. The CLI reads `package.json` from `process.cwd()`, so it reports `unknown` (or another project's version) when run from another directory. | V0.1.25 |
| F2 | Docs | `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` | README says there is no server, lists Lucide icons (the app uses Phosphor), lists already-shipped items as future work, and omits `test`, `scan`, `start` scripts. ARCHITECTURE still says "Backend: None", "alert for errors", "duplicated penalties", "no URL routes". DEPLOYMENT says Node 18+ while `engines` requires `>=20.6`. | V0.1.25 |
| F3 | Security, Bug | `src/lib/parser.ts:179`, `:214`, `:350` | Disabled headers, disabled query params and disabled form fields are dropped by the parser, so the auditor never sees them. They still ship inside the exported JSON, so a disabled `Authorization: Bearer <real token>` is a silent leak. | V0.1.26 |
| F4 | Bug | `src/lib/auditor.ts:224`, `:257`; `src/lib/redaction.ts` `body()`; `src/lib/repairEngine.ts` `patchBodySecrets` | Raw JSON bodies that contain unquoted Postman variables (`{"id": {{userId}}, "password": "hunter2"}`) fail `JSON.parse`. The fallback heuristic is then skipped entirely because the body contains `{{`. Result: no finding, no redaction, no repair. This body shape is very common. | V0.1.27 |
| F5 | Security, Bug | `src/lib/parser.ts`, `src/lib/redaction.ts` | Collection, folder and request descriptions are never scanned or redacted. Folder-level and request-level `variable` arrays and `url.variable` path variables are not parsed. Saved response `originalRequest` bodies are redacted but never audited. The sanitized copy can still contain secrets. | V0.1.28 |
| F6 | Bug | `src/lib/auditor.ts:547-556` | `HARDCODED_BASEURL` treats a URL as variabilized when `{{baseUrl}}` appears anywhere (for example in a query parameter). `HARDCODED_ENV_URL` matches path segments such as `/v1/prod/items`, ignores `uat`, `qa`, `preprod`, `sandbox`, and is skipped whenever any variable exists in the URL. | V0.1.29 |
| F7 | Bug | `src/lib/auditor.ts:560` | `MISSING_AUTH` only looks for an `Authorization` header. Requests authenticated with `X-API-Key`, a session `Cookie`, a query credential variable, or a script that adds the header are reported as unprotected. | V0.1.29 |
| F8 | Bug | `src/lib/auditor.ts:62` | Script scanning misses `pm.request.headers.add/upsert({ key: 'Authorization', value: 'Bearer ...' })`, `pm.sendRequest` header literals, and `Authorization: 'Bearer ...'` object properties because `Authorization` is not a sensitive key and the value is not inspected. | V0.1.30 |
| F9 | Security | `server/security.ts:45`, `:124` | With `TRUST_PROXY=true` the client IP is the left-most `X-Forwarded-For` entry, which the client controls. Rotating that header bypasses rate limits and the Basic auth lockout. Once more than 50k IPs are tracked, `authFailures.clear()` wipes every lockout, which a spoofing attacker can trigger on purpose. | V0.1.31 |
| F10 | Bug | `src/lib/repairEngine.ts:183`, `:607` | The base URL repair maps every origin to one `{{baseUrl}}`. A collection that calls `auth.example.com` and `api.example.com` is silently rewritten so the auth requests hit the API host. Object URLs keep a stale `port`. | V0.1.32 |
| F11 | Bug | `src/lib/redaction.ts:128`, `src/lib/reportExport.ts:213` | Redacting `url.query[]` entries does not increment `redactedCount`. The Markdown report prints an emoji, which the style guide forbids. Redacted JSON bodies lose their original indentation. | V0.1.32 |
| F12 | Enhancement | `src/lib/severity.ts:23` | One penalty per rule, regardless of how many requests are affected, and hygiene findings lower the security grade. Five critical rules always produce 0. Teams cannot tune weights. | V0.1.36 |
| F13 | Feature gap | Docs "Limitations" | Postman environments and globals are not analyzed, although they are where tenant URLs and client secrets usually live. | V0.1.34 |
| F14 | Security gap | `server/libraryStore.ts` | Library records are stored in plaintext (unless redaction is on) and there is no audit trail of who saved or removed a collection. | V0.1.40 |
| F15 | Chore | `.github/workflows/ci.yml` | No lint, no Docker build, dependency audit is `continue-on-error`, no CodeQL, no Dependabot, no browser smoke test. | V0.1.44 |

---

## 2. Release overview

| Version | Tag | Track | Type | Title | Commit |
|---|---|---|---|---|---|
| V0.1.25 | `v0.1.25` | A1 | Chore, Docs, Bug | Version alignment, changelog, release tags, stale docs | `68d478a` |
| V0.1.26 | `v0.1.26` | A1 | Security, Bug | Audit disabled headers, query params and form fields | `d693acc` |
| V0.1.27 | `v0.1.27` | A1 | Bug | Variable-tolerant body parsing | `85e530d` |
| V0.1.28 | `v0.1.28` | A1 | Security, Bug | Descriptions, item variables, path variables, saved request bodies | `7e41077` |
| V0.1.29 | `v0.1.29` | A1 | Bug | URL and auth rule accuracy | `b971633` |
| V0.1.30 | `v0.1.30` | A1 | Bug, Enhancement | Script credential detection gaps | `b0e64da` |
| V0.1.31 | `v0.1.31` | A1 | Security | Trusted proxy and lockout hardening | `807e12f` |
| V0.1.32 | `v0.1.32` | A1 | Bug | Repair, redaction and report fixes | `61b576f` |
| V0.1.33 | `v0.1.33` | A2 | Enhancement | Secret pattern expansion and Basic token decoding | `bff360d` |
| V0.1.34 | `v0.1.34` | A2 | Feature | Postman environments and globals | `f5c3110` |
| V0.1.35 | `v0.1.35` | A2 | Feature | Variable integrity rules | `00911f8` |
| V0.1.36 | `v0.1.36` | A2 | Enhancement | Scoring model v2 | `a50f91e` |
| V0.1.37 | `v0.1.37` | A3 | Feature | Config file, baselines and suppressions | `53e2814` |
| V0.1.38 | `v0.1.38` | A3 | Enhancement | Precise SARIF locations, report schema, HTML report | `ae025e7` |
| V0.1.39 | `v0.1.39` | A3 | Feature, Chore | Standalone CLI, GitHub Action, compiled server | `a5c4b6f` |
| V0.1.40 | `v0.1.40` | A4 | Security, Feature | Library encryption at rest, audit log, proxy identity | `9d6f5d0` |
| V0.1.41 | `v0.1.41` | A4 | Feature | Collection comparison and drift | `1df0a2c` |
| V0.1.42 | `v0.1.42` | A5 | Enhancement | Deep links and accessibility | |
| V0.1.43 | `v0.1.43` | A5 | Enhancement | Performance: code splitting, virtualization, budgets | |
| V0.1.44 | `v0.1.44` | A6 | Chore | Lint, format, CI hardening, browser smoke tests | |
| V0.1.45 | `v0.1.45` | A6 | Security, Chore | Tailwind CSS 4 migration and dependency refresh | |
| V0.2.0 | `v0.2.0` | B0 | Feature | Rule packs, identity category, compliance metadata | |
| V0.2.1 | `v0.2.1` | B0 | Feature | Identity context extraction and platform fingerprinting | |
| V0.2.2 | `v0.2.2` | B1 AM | Feature | OAuth 2.0 and OIDC flow rules | |
| V0.2.3 | `v0.2.3` | B1 AM | Feature | JWT inspection rules | |
| V0.2.4 | `v0.2.4` | B1 AM | Feature | SAML, sessions and token revocation coverage | |
| V0.2.5 | `v0.2.5` | B2 IGA | Feature | SCIM 2.0 provisioning analysis | |
| V0.2.6 | `v0.2.6` | B2 IGA | Feature | Joiner, mover, leaver coverage map | |
| V0.2.7 | `v0.2.7` | B2 IGA | Feature | Governance APIs and personal data exposure | |
| V0.2.8 | `v0.2.8` | B3 PAM | Feature | PAM and secrets vault API rules | |
| V0.2.9 | `v0.2.9` | B3 PAM | Feature | Privileged and admin-plane operations inventory | |
| V0.2.10 | `v0.2.10` | B4 | Feature | Platform profiles: access management and CIAM | |
| V0.2.11 | `v0.2.11` | B4 | Feature | Platform profiles: IGA, PAM and cloud IAM | |
| V0.2.12 | `v0.2.12` | B5 | Feature | Identity page | |
| V0.2.13 | `v0.2.13` | B5 | Feature | IAM reporting and compliance mapping | |
| V0.2.14 | `v0.2.14` | B5 | Enhancement | IAM repair fixes | |
| V0.2.15 | `v0.2.15` | B5 | Feature, Docs | IAM sample collections and guide | |

---

## 3. Track A: Core platform

### Milestone A1: Correctness and security fixes

#### V0.1.25: Version alignment, changelog, release tags, stale docs

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.25` | Chore, Docs, Bug | Release plumbing, CLI, docs | None |

```text
Update V0.1.25

- Aligned the app, Docker image and CLI version with the release number
- Added a changelog and release tags
- Fixed the CLI reporting the wrong version outside the project folder
- Updated README and architecture docs to match the current app
```

**Scope**
- `package.json` version `0.1.25`; `Dockerfile` `ARG APP_VERSION=0.1.25`; `compose.yaml` default `POSTSCOPE_VERSION`; DEPLOYMENT examples use a `<version>` placeholder instead of `0.0.1`.
- `cli/postscope.ts` `readVersion()`: resolve `package.json` relative to the module (`fileURLToPath(new URL('../package.json', import.meta.url))`), fall back to `APP_VERSION`. Same approach in `server/appVersion.ts` (keep the env override).
- New `CHANGELOG.md` seeded from the V0.0.1 to V0.1.24 commit bullets (newest first).
- Add a `scripts/release-check.mjs` (or a test) that fails when `package.json`, `Dockerfile` and `compose.yaml` versions disagree; run it in CI.
- README: tech stack (Phosphor icons, React Router, Node server, Web Worker), scripts table (`test`, `scan`, `start`, `typecheck`, `audit:deps`), remove shipped items from "Future improvements", link `ROADMAP.md` and `CHANGELOG.md`, Node `>=20.6`.
- `docs/ARCHITECTURE.md`: replace outdated statements (backend, persistence, alerts, penalty duplication, routing) or point to the technical mindmap as the source of truth. `docs/DEPLOYMENT.md`: Node 20.6+.

**Acceptance**
- `curl /api/config` returns `appVersion: "0.1.25"` without `APP_VERSION` set.
- `node --import tsx /path/to/cli/postscope.ts --version` from `/tmp` prints `0.1.25`.
- Version consistency check passes in CI.

---

#### V0.1.26: Audit disabled headers, query params and form fields

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.26` | Security, Bug | Parser, auditor, repair, UI | V0.1.25 |

```text
Update V0.1.26

- Security fix: disabled headers, query params and form fields are now checked for secrets
- Disabled entries are labelled in finding evidence and in the request explorer
- Repair and sanitized exports now cover disabled entries
```

**Why:** F3. Postman keeps disabled entries in the export, so a disabled credential is as exposed as an enabled one.

**Scope**
- `parser.ts`: keep active lists unchanged for existing consumers and add `disabledHeaders?: KeyValue[]`, `disabledQueryParams?: KeyValue[]`, `disabledBodyFields?: KeyValue[]` on `ParsedRequest`. Also keep disabled saved-response request headers. Disabled events (`event.disabled`) are kept as `scripts.disabledPrerequest/disabledTest` or a flag on `ParsedScript`.
- `auditor.ts`: run secret rules only (`HARDCODED_*`, `SECRET_IN_QUERY`, `SECRET_IN_SCRIPT`, `KNOWN_SECRET_PATTERN`) on disabled entries. Evidence location gets a ` (disabled)` suffix. Hygiene and `MISSING_AUTH` keep ignoring disabled entries.
- `repairEngine.ts`: header, query and body patchers also patch disabled entries. `redaction.ts`: confirm query and form-data disabled entries are scrubbed (headers already are).
- `RequestsPage.tsx`: show disabled entries greyed out with a "Disabled" badge, masked like active values.

**Tests:** parser keeps disabled entries; auditor flags a disabled `Authorization` header, a disabled `api_key` query param and a disabled form `password`; sanitized copy contains no disabled secret; repair patches them.

---

#### V0.1.27: Variable-tolerant body parsing

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.27` | Bug | Auditor, redaction, repair | V0.1.26 |

```text
Update V0.1.27

- Fixed secrets being missed in JSON bodies that contain unquoted Postman variables
- Enhanced detection for XML and form-like raw bodies
- Repair and sanitized exports now handle these bodies without breaking the variables
```

**Why:** F4.

**Scope**
- New shared helper `src/lib/jsonBody.ts`: `parseTemplatedJson(raw)` replaces unquoted `{{name}}` tokens (outside JSON strings) with unique sentinel strings, parses, and returns `{ value, restore(serialized) }` so callers can re-serialize and put the original tokens back. Must be linear-time and string-aware (skip `{{` inside quoted strings).
- Use it in `auditor.ts` (`tryParseJson`), `redaction.ts` (`body`, GraphQL variables), `repairEngine.ts` (`patchBodySecrets`). Preserve indentation with the existing `detectIndent`.
- Replace the legacy raw-body heuristic with targeted scanners that do not bail on `{{`: `key=value` pairs, `<password>literal</password>` XML elements, `"key": "value"` fragments. Each hit goes through `classifyBodySecret`, so evidence is precise (`raw body password`).

**Tests:** `{"id": {{userId}}, "password": "S3cret!"}` raises `HARDCODED_PASSWORD`; the repaired and sanitized bodies still contain `{{userId}}` unquoted; an XML SOAP body with `<wsse:Password>` literal is flagged; bodies with only variables raise nothing.

---

#### V0.1.28: Descriptions, item variables, path variables, saved request bodies

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.28` | Security, Bug | Parser, auditor, redaction, types | V0.1.27 |

```text
Update V0.1.28

- Security fix: collection, folder and request descriptions are now scanned and sanitized
- Added support for folder and request level variables and URL path variables
- Saved example requests are now audited, not only sanitized
```

**Why:** F5.

**Scope**
- `types/postman.ts`: `variable?: PostmanVariable[]` on `PostmanItem`; `variable?: Array<{ key; value; description? }>` on `PostmanUrl`.
- `parser.ts`: `ParsedCollection.descriptions: Array<{ owner, ownerPath, text }>` (collection `info.description`, folders, requests; capped to 64 KB each); `ParsedCollection.scopedVariables` for folder and request variables with owner path; `ParsedRequest.pathVariables`; saved responses keep `requestBody` (first 64 KB) and `requestQuery`.
- `auditor.ts`: descriptions scanned with `findSecretPatterns` plus `key: value` / `key=value` credential fragments, reported under `KNOWN_SECRET_PATTERN` or `HARDCODED_SECRET` with location `description (folder "X")`. Scoped variables reuse `findLeakedCollectionVariables` logic and report under `SECRET_IN_COLLECTION_VARIABLE` with location `folder variable` / `request variable`. Saved request bodies go through the body classifier under `SECRET_IN_SAVED_RESPONSE`.
- `redaction.ts`: scrub descriptions (`{{REDACTED}}` for matches), folder/request variables (empty value), path variables.
- `repairEngine.ts`: `secretVariables` also clears scoped variables.

**Tests:** a GitHub token pasted in a folder description is found and removed from the sanitized copy; a folder variable `clientSecret` with a literal value is flagged and cleared; a password in a saved example request body is flagged.

---

#### V0.1.29: URL and auth rule accuracy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.29` | Bug | Auditor | V0.1.25 |

```text
Update V0.1.29

- Fixed hardcoded base URL detection when a variable only appears later in the URL
- Fixed environment URL detection matching path segments and missing common environment names
- Fixed requests using API keys, cookies or query credentials being reported as unprotected
```

**Why:** F6, F7.

**Scope**
- `HARDCODED_BASEURL`: a URL is variabilized only when the scheme+host part starts with a variable (`^\{\{[^}]+\}\}`) or the host is a variable (`https://{{host}}/...`). Any leading variable name counts, not only the five hardcoded names.
- `HARDCODED_ENV_URL`: test the hostname only (parse with the same helper as `plaintextOrigin`), label boundaries (`(^|[.-])(prod|production|stg|staging|stage|dev|develop|qa|uat|preprod|sandbox|test|int)([.-]|$)`), still flag when only the path or query has variables. Keep `localhost` behaviour. Evidence shows the host.
- `MISSING_AUTH`: a request counts as authenticated when it has any sensitive header (`isSensitiveHeader`), a session cookie, a sensitive query param (literal or variable), an `apikey` auth helper with any placement, or a request/folder/collection pre-request script that sets `Authorization` (`pm.request.headers.add|upsert`, `pm.request.auth`).
- Add an evidence entry for `MISSING_AUTH` naming the method and path so reviewers can triage quickly.

**Tests:** `https://api.acme.io/x?next={{baseUrl}}` is flagged; `https://api.acme.io/v1/prod/items` is not an environment URL; `https://api-uat.acme.io` is; `POST` with `X-API-Key: {{apiKey}}` and `noauth` is not `MISSING_AUTH`; a collection script adding the header suppresses it.

---

#### V0.1.30: Script credential detection gaps

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.30` | Bug, Enhancement | Auditor, redaction | V0.1.29 |

```text
Update V0.1.30

- Enhanced script scanning for headers added with pm.request.headers and pm.sendRequest
- Fixed literal Authorization values in script objects not being detected
- Sanitized exports now scrub these script literals
```

**Why:** F8.

**Scope**
- `auditor.ts` `scanScript`: new patterns for `pm.request.headers.add|upsert({ key: '...', value: '...' })`, `pm.request.headers.add('Name: value')`, `header: { Authorization: '...' }` inside `pm.sendRequest`, `pm.request.auth` bearer literals, `btoa('user:literal')`. Treat `Authorization`, `Proxy-Authorization`, `Cookie` and `isSensitiveHeader` names as sensitive in `SCRIPT_LITERAL_PROPERTY` when the value starts with an auth scheme or is a likely secret.
- `redaction.ts` `script()`: same patterns, replacing only the literal with `{{REDACTED}}`.
- Keep all regexes linear (no nested quantifiers) and line-bounded as today.

**Tests:** each new pattern positive; `pm.environment.get('token')` and `'Bearer ' + pm.environment.get('token')` produce nothing.

---

#### V0.1.31: Trusted proxy and lockout hardening

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.31` | Security | Server | V0.1.25 |

```text
Update V0.1.31

- Security fixes: client IP is now taken from trusted proxy hops only
- Security fixes: failed sign-in lockouts can no longer be flushed by flooding
- Added an option to hide the version from the public health endpoint
```

**Why:** F9.

**Scope**
- `server/runtimeConfig.ts`: `TRUST_PROXY_HOPS` (integer, default `1` when `TRUST_PROXY=true`). `getClientIp` takes the entry at position `length - hops` from the right of `X-Forwarded-For`, validates it with `net.isIP`, and falls back to the socket address.
- `recordAuthFailure`: on overflow, sweep expired windows first, then evict the oldest non-locked entries; never clear locked entries. Add a global failure ceiling (for example 10x the per-IP limit per 15 minutes) that triggers a short global back-off and a `warn` log.
- `HEALTH_EXPOSE_VERSION` (default `true` for compatibility); when `false`, `/api/health` omits `version`.
- Document both variables in `.env.example`, DEPLOYMENT, SECURITY threat table and technical mindmap section 6.

**Tests:** spoofed left-most XFF does not change the rate-limit key; 50k+ distinct spoofed IPs do not unlock a locked IP; health hides the version when configured.

---

#### V0.1.32: Repair, redaction and report fixes

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.32` | Bug | Repair engine, redaction, reports | V0.1.27 |

```text
Update V0.1.32

- Fixed base URL repair merging different hosts into one variable
- Fixed repaired object URLs keeping a stale port
- Fixed sanitized export counts and kept original JSON indentation
- Removed emoji from the Markdown report
```

**Why:** F10, F11.

**Scope**
- `repairEngine.ts`: build an origin to variable map. The most frequent origin keeps `baseUrl`; others get a readable name from the first host label (`auth.example.com` to `authBaseUrl`, collisions get a numeric suffix). `replaceUrlHostWithBaseUrl` takes the map. Preview lists every mapping. Object URLs: set `host`, remove `protocol` and `port`, keep `path`, `query`, `variable`.
- `redaction.ts`: count query array redactions; reuse `detectIndent` when re-serializing bodies.
- `reportExport.ts`: `No findings.` without emoji.

**Tests:** two-host collection produces two variables and each request keeps its host; object URL with port repaired cleanly; redaction count includes query params; Markdown report has no emoji.

---

### Milestone A2: Detection coverage

#### V0.1.33: Secret pattern expansion and Basic token decoding

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.33` | Enhancement | `secretPatterns.ts`, auditor | V0.1.32 |

```text
Update V0.1.33

- Added detection for more provider token formats including identity platforms and vaults
- Basic authorization headers are now decoded to avoid false positives on variables
- Added a high-entropy literal check for credential positions
```

**Scope**
- New patterns (follow the gitleaks rule definitions for exact shapes, keep regexes linear): Microsoft Entra ID client secret (`Q~` marker), Okta API token (`SSWS 00...`), HashiCorp Vault tokens (`hvs.`, `hvb.`, `hvr.`, legacy `s.` only when the header is `X-Vault-Token`), Postman API key (`PMAK-`), Atlassian (`ATATT`), Shopify (`shpat_`, `shpss_`), DigitalOcean (`dop_v1_`), Docker Hub (`dckr_pat_`), Grafana (`glsa_`, `glc_`), Hugging Face (`hf_`), Databricks (`dapi`), PyPI (`pypi-AgE`), Square (`sq0atp-`, `EAAA`), Mailgun (`key-` 32 hex, only in auth contexts).
- `Authorization: Basic <b64>`: decode; when the decoded `user:pass` has a variable password or is a placeholder, do not report `HARDCODED_TOKEN`; when the password is literal, add evidence `basic credentials for user <masked>`.
- New rule `HIGH_ENTROPY_LITERAL` (warning, secrets, CWE-798): literal values in sensitive positions that no other rule flagged, length >= 20 and Shannon entropy >= 3.5 bits/char, excluding UUIDs and pure hex ids under 32 chars.
- Update the secret detection table in SECURITY.md.

**Tests:** one positive and one near-miss per new pattern (fake tokens built at runtime); Basic header with `{{password}}` encoded is not flagged.

---

#### V0.1.34: Postman environments and globals

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.34` | Feature | Parser, auditor, UI import, CLI, redaction | V0.1.33 |

```text
Update V0.1.34

- Added support for importing Postman environment and globals files with a collection
- Added detection of secrets stored in environment and globals exports
- Environment values are now used to resolve base URLs for transport checks
- Added environment support to the CLI and sanitized exports
```

**Why:** F13. Environments carry tenant URLs and client secrets. Postman `secret` typed variables are still exported in clear text.

**Scope**
- `src/lib/environment.ts`: `parseEnvironment(json)` for `*.postman_environment.json` (`values[]`, `_postman_variable_scope: environment`) and `*.postman_globals.json`. Detect the file kind automatically.
- `ParsedCollection.environments?: ParsedEnvironment[]`; `resolveLeadingVariable` checks collection, then selected environment, then globals (same precedence as Postman: local > data > environment > collection > global is noted in docs; PostScope only needs environment over collection for URL resolution).
- New rule `SECRET_IN_ENVIRONMENT` (critical, secrets, CWE-798): credential-like names, `type: secret`, or provider patterns with literal values. Evidence location `environment "<name>" variable <key>`.
- UI: DropZone accepts multiple files; collection plus zero or more environments; an environment selector in the header when several are loaded. Session restore keeps environments.
- CLI: `--environment <file>` (repeatable) and `--globals <file>`. `--sanitize` writes sanitized environment copies next to the output (`<name>.sanitized.postman_environment.json`).
- `redaction.ts`: `redactEnvironment(json)`.
- Library: environments are not stored server-side in this version (document it).

**Tests:** environment secret detection; `{{baseUrl}}` resolved through the environment triggers `INSECURE_HTTP`; CLI multi-file flags; sanitized environment has empty secret values.

---

#### V0.1.35: Variable integrity rules

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.35` | Feature | Auditor, repair | V0.1.34 |

```text
Update V0.1.35

- Added detection of variables that are referenced but never defined
- Added detection of collection variables that are never used
- Added a repair to create placeholders for undefined variables
```

**Scope**
- `UNDEFINED_VARIABLE` (warning, variables): names referenced in URLs, headers, bodies, auth fields or scripts (`pm.*.get('x')`) that are not defined in the collection, scoped variables, loaded environments, globals, or set by any script (`pm.*.set('x', ...)`). Built-in `{{$...}}` names excluded. When no environment is loaded, downgrade to info and say "may be defined in an environment".
- `UNUSED_COLLECTION_VARIABLE` (info, hygiene): defined but never referenced.
- Repair: `undefinedVariables` fix kind adds empty collection variables (low risk, not selected by default).
- Overview: "Variables" stat card shows defined, referenced, undefined counts.

**Tests:** script-set variables are not undefined; dynamic variables ignored; environment satisfies references.

---

#### V0.1.36: Scoring model v2

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.36` | Enhancement | Scorer, UI, reports, server config | V0.1.35 |

```text
Update V0.1.36

- Enhanced scoring to account for how many requests each finding affects
- Separated the security score from the hygiene score
- Added configurable score weights for teams
```

**Why:** F12.

**Scope**
- `severity.ts`: penalty per finding = `base[severity] * (1 + log2(affectedCount))`, capped per rule (critical 35, warning 15, info 4). Collection-level findings use `affectedCount = max(1, evidence.length)` capped at 8.
- `ScoreBreakdown` gains `security` (secrets, auth, variables) and `hygiene` totals; `total` remains for compatibility and is computed as `round(0.85 * security + 0.15 * hygiene)`. Document the formula in the technical mindmap.
- `SCORE_WEIGHTS` env (`critical=20,warning=8,info=2`) and CLI `--weights`; exposed in `/api/config` like `auditPolicy`.
- Score page shows both scores and the per-finding penalty breakdown. Reports include `scoreModel: 2`.
- `requestHealthScore` keeps using `penaltyScore` per request (one request = affectedCount 1).

**Tests:** monotonic (more affected requests never raises the score); weights override; 0 to 100 bounds; existing CLI `--min-score` behaviour documented if thresholds shift.

---

### Milestone A3: CI, CLI and reporting

#### V0.1.37: Config file, baselines and suppressions

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.37` | Feature | CLI, auditor, reports, UI | V0.1.36 |

```text
Update V0.1.37

- Added a project config file for rules, severities and weights
- Added baseline files so CI only fails on new findings
- Added reviewed suppressions with a mandatory reason
```

**Scope**
- `.postscope.json` (searched upward from the input file, or `--config`): `disabledRules`, `severityOverrides`, `weights`, `rulePacks` (reserved for V0.2.0), `suppressions[]` (`ruleId`, `request` glob on request id, optional `location` substring, `reason`, optional `expires`). Validate with `sanitizeAuditOptions`-style normalization.
- Finding occurrence fingerprint: `sha256(ruleId | requestId | evidence.location)`, exported in JSON and SARIF (`partialFingerprints`).
- `--baseline <file>` and `--write-baseline <file>`: report and fail only on occurrences not in the baseline.
- Inline suppression: a line `postscope-ignore RULE_ID: reason` in a request or folder description. Reason is mandatory; expired suppressions raise a `SUPPRESSION_EXPIRED` info finding.
- Suppressed occurrences are kept in reports (`suppressed: true`, SARIF `suppressions[]`) and do not count toward score or `--fail-on`. UI shows a "Suppressed" filter.

**Tests:** baseline round trip; suppression without reason rejected; expired suppression reported.

---

#### V0.1.38: Precise SARIF locations, report schema, HTML report

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.38` | Enhancement | Reports, CLI, UI export | V0.1.37 |

```text
Update V0.1.38

- Enhanced SARIF output with line and column locations in the collection file
- Added a versioned JSON report schema
- Added a self-contained HTML report export
```

**Scope**
- `src/lib/jsonPositions.ts`: single-pass scanner that maps JSON pointers to `{ line, column }` without building a second tree (bounded memory). Evidence gains `pointer` (for example `/item/0/item/3/request/header/1/value`). Parser records item pointers alongside `itemPath`.
- SARIF: `region.startLine/startColumn`, `invocations[0].executionSuccessful`, `automationDetails.id`, a run-level note when results were truncated at 5000.
- JSON report: `reportVersion: 2`, schema in `docs/schemas/postscope-report.v2.schema.json`; a test validates generated reports against it (use a tiny in-repo validator or `ajv` as a dev dependency).
- HTML report: one file, inline CSS, no scripts (works under strict CSP and offline), masked evidence only, print-friendly. Menu item in `app-header.tsx`, CLI `--format html`.

**Tests:** pointer to line mapping on a fixture with CRLF and unicode; schema validation; HTML contains no `<script>` and no unmasked fixture secret.

---

#### V0.1.39: Standalone CLI, GitHub Action, compiled server

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.39` | Feature, Chore | CLI packaging, CI integrations, Docker | V0.1.38 |

```text
Update V0.1.39

- Added a standalone postscope command that runs without the TypeScript toolchain
- Added a GitHub Action and CI examples for GitLab and Azure DevOps
- Added directory and glob scanning to the CLI
- Reduced the Docker image size by compiling the server
```

**Scope**
- Build `cli/postscope.ts` and `server/index.ts` to ESM JavaScript (`esbuild` dev dependency, `npm run build:node`), `bin: { "postscope": "dist-node/cli.js" }`.
- CLI accepts directories and globs (`postscope scan collections/**/*.postman_collection.json`), pairs `*.postman_environment.json` found next to collections when `--auto-env` is set, `--format junit` for CI test tabs.
- `action.yml` (composite action): inputs `path`, `fail-on`, `min-score`, `baseline`, `sarif-output`; uploads SARIF via `github/codeql-action/upload-sarif` in the documented example.
- Docs: `docs/CI.md` with GitHub, GitLab and Azure DevOps snippets and a pre-commit hook example.
- Dockerfile runtime stage runs compiled JS with production dependencies only (`npm ci --omit=dev`), resolving the trade-off noted in DEPLOYMENT.

**Tests:** CLI e2e through the compiled entry; glob expansion; JUnit output shape; image smoke test in CI (V0.1.44 adds the job).

---

### Milestone A4: Platform and data

#### V0.1.40: Library encryption at rest, audit log, proxy identity

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.40` | Security, Feature | Server, library store | V0.1.39 |

```text
Update V0.1.40

- Security fixes: optional encryption at rest for the team library
- Added an append-only audit log for library saves, opens and removals
- Added support for user identity from a trusted reverse proxy
```

**Why:** F14.

**Scope**
- `LIBRARY_ENCRYPTION_KEY` (32-byte base64 or hex, or `LIBRARY_ENCRYPTION_KEY_FILE` for Docker secrets): AES-256-GCM per record with random 12-byte IV, versioned envelope `{ v: 1, iv, tag, data }`; existing plaintext records stay readable; `npm run library:encrypt` migrates them. Content hash for dedupe stays computed on plaintext but stored as an HMAC keyed with the encryption key.
- `data/audit/library-YYYY-MM.jsonl`: `{ ts, action, id, name, user, ip, requestId, redactedCount }`, never collection content. `LIBRARY_AUDIT_LOG=true|false`.
- `TRUSTED_USER_HEADER` (for example `X-Forwarded-User` or `X-Auth-Request-Email`), honored only when `TRUST_PROXY=true`; recorded as `savedBy` in metadata and in the audit log; shown in the library dialog.
- SECURITY.md and DEPLOYMENT.md: key management, rotation procedure, oauth2-proxy example for SSO.

**Tests:** encrypt/decrypt round trip; tampered record rejected and skipped; audit entries written for save/delete; user header ignored without `TRUST_PROXY`.

---

#### V0.1.41: Collection comparison and drift

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.41` | Feature | Engine, UI, CLI | V0.1.37 |

```text
Update V0.1.41

- Added comparison of two collections or two library versions
- Shows new, resolved and unchanged findings with the score change
- Added a CLI diff command for pull request checks
```

**Scope**
- `src/lib/compare.ts`: match requests by id, then by method + normalized URL; match findings by occurrence fingerprint (V0.1.37). Output: added/removed/changed requests, new/resolved findings, score delta, new hosts, new auth types.
- UI: "Compare" action in the library dialog and on the import page (second file). New Compare page.
- CLI: `postscope diff old.json new.json --fail-on-new critical`.

**Tests:** renamed request matched by URL; resolved finding reported; deterministic output order.

---

### Milestone A5: UX and performance

#### V0.1.42: Deep links and accessibility

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.42` | Enhancement | Routing, UI | V0.1.41 |

```text
Update V0.1.42

- Added shareable links to pages, filters and findings within a session
- Accessibility fixes for keyboard navigation, focus and screen readers
```

**Scope**
- Move dashboard `NavId` state into React Router routes (`/analyze/security?severity=critical&rule=HARDCODED_TOKEN`, `/analyze/requests/<encoded id>`). Browser back/forward works. Links never contain collection content.
- Keyboard: request tree arrow-key navigation, `/` focuses search, `Esc` closes dialogs consistently, visible focus rings per DESIGN_SYSTEM.
- Run `@axe-core/playwright` (added in V0.1.44) or a manual axe pass now; fix contrast, labels on icon-only buttons, `aria-live` for analysis progress.

**Tests:** route parsing unit tests; axe report with zero serious violations on Overview, Security, Requests, Score.

---

#### V0.1.43: Performance: code splitting, virtualization, budgets

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.43` | Enhancement | Build, UI, worker | V0.1.42 |

```text
Update V0.1.43

- Faster first load with page-level code splitting
- Smooth scrolling for collections with thousands of requests and findings
- Added performance budgets to CI
```

**Scope**
- `React.lazy` per page; Recharts and framer-motion only loaded by pages that use them; landing page does not load the analyzer bundle.
- Virtualize the request tree, requests list, finding lists and repair list above 300 rows (small in-repo windowing component to avoid a heavy dependency).
- Worker returns a compact result (drop `bodyRaw` above 64 KB for display, keep a flag); transfer large strings once.
- `scripts/bench.mjs` using `generate-heavy-demo-collection.mjs`: parse + audit time and main bundle size budgets; CI fails on regressions above 20 percent.

**Tests:** bench script runs in CI; bundle size report artifact.

---

### Milestone A6: Engineering quality

#### V0.1.44: Lint, format, CI hardening, browser smoke tests

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.44` | Chore | Tooling, CI | V0.1.43 |

```text
Update V0.1.44

- Added linting and formatting checks
- Hardened CI with Docker build, code scanning and dependency updates
- Added browser smoke tests for the main pages
```

**Scope**
- ESLint flat config (typescript-eslint, react-hooks, jsx-a11y) and Prettier check matching the current style; fix or explicitly disable existing violations in the same commit.
- CI: `npm run lint`, release version check, Docker build + container `/api/health` smoke, CodeQL workflow, Dependabot for npm and GitHub Actions, `npm run audit:deps` blocking for runtime dependencies.
- Playwright smoke (`executablePath` aware for preinstalled Chromium): import each sample, visit every page, export each report format, verify no console errors and no unmasked secret in the DOM by default.
- A `no-em-dash` check (simple grep script) in CI enforcing VISUAL_STYLE.

---

#### V0.1.45: Tailwind CSS 4 migration and dependency refresh

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.1.45` | Security, Chore | Build, styles | V0.1.44 |

```text
Update V0.1.45

- Security fixes: cleared build tool advisories by moving to Tailwind CSS 4
- Updated dependencies
- General UI fixes after the styling migration
```

**Scope**
- Migrate `tailwind.config.ts` tokens to the CSS-first `@theme` config, keep every HSL token from `src/index.css`, verify light and dark themes page by page with Playwright screenshots from V0.1.44.
- Update React Router, Radix, Recharts, Vite to current minors; remove unused dependencies (check `canvas-confetti` usage against CSP `blob:` need; if kept, document).
- Update the technical mindmap "Known limitations" list.

---

## 4. Track B: Postman collections for IAM platforms

### 4.1 Why a dedicated IAM track

Identity teams use Postman more than most: Okta, Microsoft Entra ID (Graph), Auth0, Ping, Keycloak, SailPoint, Saviynt, CyberArk, BeyondTrust, Delinea and HashiCorp Vault all ship or document Postman collections, and IAM engineers keep collections for OAuth flows, SCIM provisioning, access reviews and privileged credential retrieval. Those collections hold the most sensitive material in an organization: tenant admin tokens, client secrets, vault tokens, and saved examples that captured real passwords or user data.

The generic rules already catch many literal secrets. The IAM track adds **identity context**: which platform and endpoint a request targets, which OAuth flow it uses, whether it changes privileges, whether it retrieves a privileged credential, and whether the collection covers the full identity lifecycle. Section 5 is the detailed analysis reference this track implements.

### 4.2 Design principles

- **Static only.** PostScope never calls the identity platforms. Everything is inferred from the export.
- **Opt-in packs.** IAM rules live in rule packs that are auto-enabled when identity signals are detected and can be forced on or off (`AUDIT_RULE_PACKS`, `--packs`, rule settings dialog).
- **Inventory plus findings.** Many IAM elements are inventories (clients, scopes, privileged operations, JML coverage) shown on the Identity page and in reports; only clear risks become findings that affect the score.
- **Explainable.** Every IAM finding cites the platform, the endpoint class, and a standard reference (RFC, NIST, ISO, CIS, OWASP).

### Milestone B0: Foundation

#### V0.2.0: Rule packs, identity category, compliance metadata

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.0` | Feature | Rules registry, scorer, UI, CLI, config | V0.1.37 |

```text
Update V0.2.0

- Added rule packs so groups of rules can be enabled per team or project
- Added the identity finding category with its own score
- Added compliance references to every rule
```

**Scope**
- `rules.ts`: `RuleDefinition` gains `pack: 'core' | 'iam-am' | 'iam-iga' | 'iam-pam' | 'iam-platform'`, `tags: string[]`, `references?: { nist80053?: string[]; iso27001?: string[]; cisV8?: string[]; rfc?: string[] }`. Back-fill references for the 27+ core rules.
- `severity.ts`: `FindingCategory` adds `identity`; `CATEGORY_ORDER` updated. Scorer computes the identity category only when identity findings or an identity profile exist; otherwise it is omitted from the breakdown (not shown as 100).
- `AuditOptions.rulePacks?: { enabled?: string[]; disabled?: string[] }`; default `auto` (IAM packs on when V0.2.1 detects identity signals). Server `AUDIT_RULE_PACKS`, CLI `--packs`, `.postscope.json` `rulePacks`.
- Rule settings dialog groups rules by pack with a pack-level toggle. Security page category filter adds Identity.
- Reports: `pack` and references per rule; SARIF `properties.tags` include pack and framework ids.

**Tests:** pack toggling, category omission when no identity signals, references present for every rule (registry test).

---

#### V0.2.1: Identity context extraction and platform fingerprinting

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.1` | Feature | New `src/lib/iam/` module, worker, reports | V0.2.0, V0.1.34 |

```text
Update V0.2.1

- Added detection of identity platforms used by a collection
- Added classification of identity endpoints such as token, SCIM, admin and vault calls
- Added OAuth client and scope inventories
```

**Scope**
- `src/lib/iam/fingerprints.ts`: platform table from section 5.6 (host suffixes, path prefixes, header names, token formats) with a confidence score; multiple platforms per collection allowed.
- `src/lib/iam/endpoints.ts`: `classifyEndpoint(request)` returns one of the endpoint classes in section 5.1 (`oauth.token`, `oauth.authorize`, `oauth.par`, `oauth.device`, `oauth.introspect`, `oauth.revoke`, `oidc.userinfo`, `oidc.discovery`, `oidc.jwks`, `oidc.logout`, `saml.acs`, `saml.sso`, `scim.users`, `scim.groups`, `scim.bulk`, `scim.schemas`, `iga.access-request`, `iga.certification`, `iga.sod`, `admin.role-assignment`, `admin.policy`, `admin.credential-mint`, `pam.retrieve`, `pam.checkout`, `pam.checkin`, `pam.session`, `vault.read`, `vault.write`, `cloud-iam.*`, `unknown`). Rules match on normalized paths with variables replaced by `*`.
- `src/lib/iam/profile.ts`: `buildIdentityProfile(parsed)` returns `{ platforms, endpoints, oauthClients, scopes, grants, tokens }`. OAuth clients come from oauth2 auth helpers (`grant_type`, `clientId`, `accessTokenUrl`, `authUrl`, `scope`, `challengeAlgorithm`, `client_authentication`, `redirect_uri`) and from token request bodies (`grant_type=...`).
- Worker returns the profile with the analysis; JSON report gets an `identity` section (no secrets, client ids masked when literal).

**Tests:** fixtures per platform family (built with fake values), endpoint classification table tests, profile is empty for the existing samples.

---

### Milestone B1: Access Management (AM)

#### V0.2.2: OAuth 2.0 and OIDC flow rules

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.2` | Feature | IAM rules (pack `iam-am`) | V0.2.1 |

```text
Update V0.2.2

- Added OAuth and OpenID Connect checks for deprecated grants, missing PKCE and unsafe redirects
- Added detection of tokens sent in URLs and over-broad scopes
- Token endpoints over plain HTTP are now reported as critical
```

**Rules** (all category `identity`, details in section 5.1):

| Rule id | Severity | Summary |
|---|---|---|
| `OAUTH_IMPLICIT_GRANT` | warning | `response_type=token` or oauth2 helper `grant_type: implicit` |
| `OAUTH_PASSWORD_GRANT` | warning | Resource owner password credentials grant (`grant_type=password`, oauth2 `password_credentials`) |
| `OAUTH_PKCE_MISSING` | warning | Authorization code flow for a public or browser client without PKCE |
| `OAUTH_PKCE_PLAIN` | warning | `code_challenge_method=plain` or helper `challengeAlgorithm: plain` |
| `OAUTH_REDIRECT_URI_UNSAFE` | warning | `redirect_uri` over http to a non-local host, with wildcards, or with an open-redirect style parameter |
| `OAUTH_STATE_MISSING` | info | Authorize request without `state` (and without PKCE or nonce for OIDC) |
| `OAUTH_TOKEN_ENDPOINT_HTTP` | critical | Token, introspection or revocation endpoint over http (escalation of `INSECURE_HTTP`) |
| `OAUTH_TOKEN_IN_URL` | critical | `access_token`, `id_token` or `code` with literal value in query or fragment |
| `OAUTH_BROAD_SCOPE` | warning | Wildcard or tenant-wide admin scopes (catalog in section 5.1.3) |
| `OAUTH_CLIENT_SECRET_POST` | info | Client secret sent in the body when the platform supports `client_secret_basic` or `private_key_jwt` |

**Tests:** one fixture per rule plus safe counterparts (auth code + S256, `client_credentials` with `{{clientSecret}}`, `localhost` redirect).

---

#### V0.2.3: JWT inspection rules

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.3` | Feature | IAM rules (pack `iam-am`), UI modal | V0.2.2 |

```text
Update V0.2.3

- Added inspection of tokens found in collections for unsafe algorithms, long lifetimes and sensitive claims
- Added a masked token inspector to the request details
```

**Scope**
- `src/lib/iam/jwt.ts`: decode header and payload of every JWT match (no signature verification, no network), bounded to 16 KB per token.
- Rules: `JWT_ALG_NONE` (critical), `JWT_LONG_LIVED` (warning, `exp - iat` over 24h for access tokens, or no `exp`), `JWT_SENSITIVE_CLAIMS` (warning, personal data or privilege claims in a token stored in the collection), `ID_TOKEN_AS_BEARER` (warning, token with `nonce`/`at_hash` or `typ` id token sent as `Authorization: Bearer` to a non-userinfo API), `JWT_EXPIRED_STORED` (info, expired but still committed: rotate and remove).
- Evidence lists claim names and masked values (`email: j•••@•••`, `roles: [3 values]`), issuer host, and lifetime, never the signature.
- `RequestAnalysisModal`: "Token" tab showing header and masked claims for detected JWTs.

**Tests:** fake unsigned JWTs built at runtime; claims masking; no full token in evidence.

---

#### V0.2.4: SAML, sessions and token revocation coverage

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.4` | Feature | IAM rules (pack `iam-am`) | V0.2.3 |

```text
Update V0.2.4

- Added detection of captured SAML assertions in requests and saved examples
- Added checks for session cookies saved without security flags
- Added a coverage check for token revocation and logout requests
```

**Rules**
- `SAML_ASSERTION_CAPTURED` (critical): `SAMLResponse` form field or body value whose base64 decodes to `<saml:Assertion` / `<saml2:Assertion` / `<Assertion` (decode bounded to 256 KB); also in saved responses.
- `SAML_IDP_METADATA_HTTP` (warning): metadata or SSO URLs over http.
- `SESSION_COOKIE_FLAGS` (info): saved `Set-Cookie` session cookies without `Secure`, `HttpOnly` or `SameSite`.
- `TOKEN_REVOCATION_NOT_COVERED` (info): the collection obtains tokens (`oauth.token`) for a platform but contains no revocation, logout or session termination request for it. Inventory only when no token endpoint exists.

**Tests:** SAML fixture with a fake assertion; cookies with and without flags; coverage per platform.

---

### Milestone B2: Identity Governance and Administration (IGA)

#### V0.2.5: SCIM 2.0 provisioning analysis

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.5` | Feature | IAM rules (pack `iam-iga`) | V0.2.1 |

```text
Update V0.2.5

- Added SCIM provisioning checks for destructive bulk operations, unbounded queries and privilege changes
- Added an inventory of SCIM operations per target system
```

**Rules**
- `SCIM_BULK_DESTRUCTIVE` (warning): `/Bulk` with `DELETE` operations or `failOnErrors` absent on large operation lists.
- `SCIM_UNBOUNDED_LIST` (info): `GET /Users` or `/Groups` without `filter`, `count` or `startIndex`.
- `SCIM_PRIVILEGE_PATCH` (warning when the value is a literal admin role or group, info otherwise): `PATCH` operations touching `roles`, `entitlements`, `groups`, `members` or `active`.
- `SCIM_CONTENT_TYPE` (info): SCIM requests without `application/scim+json`.
- `SCIM_SCHEMA_MISMATCH` (info): request body `schemas` missing the core URN for the resource.
- Inventory: target systems (host), resources, operations count.

---

#### V0.2.6: Joiner, mover, leaver coverage map

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.6` | Feature | IAM profile, rules (pack `iam-iga`), reports | V0.2.5 |

```text
Update V0.2.6

- Added a joiner, mover and leaver coverage map per identity platform
- Added checks for missing leaver steps and hard deletes without a disable step
```

**Scope**
- Classify each identity request into lifecycle stages (section 5.2.2): Joiner (create user/account, birthright groups), Mover (attribute update, group/role changes), Leaver (disable, suspend, deactivate, remove access, revoke sessions/tokens, delete).
- Rules: `JML_LEAVER_NOT_COVERED` (info): joiner operations exist for a platform but no disable/deactivate operation; `LEAVER_DELETE_WITHOUT_DISABLE` (info): hard delete with no prior disable/suspend in the same folder sequence; `LEAVER_SESSION_NOT_REVOKED` (info): deactivation without session or token revocation (Okta `DELETE /api/v1/users/{id}/sessions`, Entra `revokeSignInSessions`, Keycloak `logout`).
- Matrix stored in the identity profile and rendered in reports and later on the Identity page.

---

#### V0.2.7: Governance APIs and personal data exposure

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.7` | Feature | IAM rules (pack `iam-iga`), redaction | V0.2.6 |

```text
Update V0.2.7

- Added detection of governance APIs such as access requests, certifications and separation of duties policies
- Added detection of personal data in saved examples and request bodies
- Added optional personal data scrubbing to sanitized exports
```

**Scope**
- Endpoint classes for SailPoint Identity Security Cloud (`/v3/access-requests`, `/v3/certifications`, `/v3/campaigns`, `/beta/sod-policies`, `/v3/search`), SailPoint IdentityIQ (`/identityiq/scim/v2`, `/identityiq/rest`), Saviynt EIC (`/ECM/api/v5/`), One Identity Manager (`/AppServer/api/`), Omada (`/OData/`).
- Rules: `PII_IN_SAVED_RESPONSE` (warning): emails, phone numbers, national identifiers (format plus checksum where one exists: Luhn for card numbers, mod-97 for IBAN), dates of birth, employee ids in saved responses; `PII_IN_REQUEST_BODY` (info) for literal personal data in request bodies; `GOVERNANCE_SELF_APPROVAL` (info): approval or decision bodies where approver and requester/recipient literals are equal; `CERTIFICATION_BULK_APPROVE` (warning): bulk approve decisions in certification calls.
- Redaction: `--redact-pii` and a "Sanitized copy (remove personal data)" export option; masked previews for PII evidence.

**Tests:** fake but checksum-valid IBAN and card numbers generated at runtime; emails in `example.com` only.

---

### Milestone B3: Privileged Access Management (PAM)

#### V0.2.8: PAM and secrets vault API rules

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.8` | Feature | IAM rules (pack `iam-pam`) | V0.2.1, V0.1.33 |

```text
Update V0.2.8

- Added checks for privileged password retrieval captured in saved examples
- Added detection of vault tokens and privileged accounts in collections
- Added checks for credential checkout without check-in and retrieval without a reason
```

**Rules** (details in section 5.3):

| Rule id | Severity | Summary |
|---|---|---|
| `PAM_RETRIEVED_SECRET_CAPTURED` | critical | Saved response of a retrieval endpoint (CyberArk, BeyondTrust, Delinea, Vault, cloud secret managers) contains the secret value |
| `PAM_VAULT_TOKEN_LITERAL` | critical | `X-Vault-Token`, CyberArk session token, BeyondTrust `PS-Auth` key or Delinea bearer stored as a literal |
| `PAM_ROOT_TOKEN_USAGE` | critical | Vault root token generation endpoints or root token shaped values |
| `PAM_RETRIEVAL_WITHOUT_REASON` | warning | Retrieval call without the reason or ticket fields the platform supports |
| `PAM_CHECKOUT_WITHOUT_CHECKIN` | info | Request/checkout flow without a matching check-in or release call |
| `PAM_PRIVILEGED_ACCOUNT_LITERAL` | warning | Literal privileged account names (`administrator`, `root`, `sa`, `krbtgt`, break-glass naming) used as credentials |
| `PAM_SAFE_ADMIN_CHANGE` | info | Safe, vault policy or permission changes (inventory, warning when granting full permissions) |

---

#### V0.2.9: Privileged and admin-plane operations inventory

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.9` | Feature | IAM profile, rules (pack `iam-pam`) | V0.2.8 |

```text
Update V0.2.9

- Added an inventory of privileged identity operations such as role assignment, policy changes and credential creation
- Added checks for super admin role grants and MFA policy weakening
```

**Rules**
- `PRIVILEGED_ROLE_ASSIGNMENT` (warning): literal assignment of top-tier roles (Okta `SUPER_ADMIN`, `ORG_ADMIN`; Entra Global Administrator template `62e90394-69f5-4237-9190-012177145e10` and Privileged Role Administrator `e8611ab8-c189-46e8-94e1-60213ab1f814`; Keycloak `realm-admin`; Auth0 admin roles; AWS `AdministratorAccess`).
- `MFA_POLICY_WEAKENING` (warning): policy or conditional access bodies that disable factors, set enforcement to none, or exclude all users.
- `CREDENTIAL_MINTING_ENDPOINT` (info, warning when the response is saved): client secret creation (Entra `addPassword`, Okta app `credentials/secrets`, Keycloak `client-secret`), API token creation, AWS `CreateAccessKey`.
- Inventory grouped by platform with "danger zone" marking for later UI use.

---

### Milestone B4: Platform profiles

#### V0.2.10: Platform profiles: access management and CIAM

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.10` | Feature | `src/lib/iam/platforms/*` (pack `iam-platform`) | V0.2.9 |

```text
Update V0.2.10

- Added platform profiles for Okta, Microsoft Entra ID, Auth0, Ping Identity, ForgeRock and Keycloak
- Added checks for hardcoded tenant identifiers and mixed tenant environments
- Added detection of retired identity APIs
```

**Scope**
- One module per platform exporting: fingerprints, token formats, endpoint map additions, expected variable names (`{{oktaDomain}}`, `{{tenantId}}`, `{{auth0Domain}}`, `{{realm}}`, `{{envId}}`), platform-specific recommendation text.
- Rules: `TENANT_IDENTIFIER_HARDCODED` (info, category variables): literal tenant GUIDs, org domains, realm names repeated across requests; `MIXED_TENANT_ENVIRONMENTS` (warning): preview and production tenants in one collection (`oktapreview.com` with `okta.com`, Auth0 dev and prod tenants, multiple Entra tenant ids); `DEPRECATED_IDENTITY_API` (warning): Azure AD Graph `graph.windows.net`, Entra v1 `/oauth2/token` without `/v2.0`, Keycloak `/auth/` legacy prefix on new versions, Okta deprecated endpoints listed in the profile.

---

#### V0.2.11: Platform profiles: IGA, PAM and cloud IAM

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.11` | Feature | `src/lib/iam/platforms/*` | V0.2.10 |

```text
Update V0.2.11

- Added platform profiles for SailPoint, Saviynt, One Identity, Omada, CyberArk, BeyondTrust, Delinea and HashiCorp Vault
- Added cloud IAM profiles for AWS, Microsoft Azure and Google Cloud
- Added detection of legacy governance and vault API versions
```

**Scope**
- Same module shape as V0.2.10. Legacy API detection: SailPoint `/cc/api/` and `/v2/` legacy endpoints, CyberArk classic `/PasswordVault/WebServices/` (v1 API), Vault KV v1 vs v2 path mismatch (`/v1/secret/` with `data` envelope).
- Cloud IAM: AWS STS and IAM query APIs (`Action=AssumeRole`, `CreateAccessKey`, `AttachUserPolicy`), SigV4 `aws` auth helper, Azure `management.azure.com` role assignments (Owner, User Access Administrator), Google `iam.googleapis.com` service account key creation (`keys:create`, flag as credential minting).

---

### Milestone B5: Experience, reporting and repair

#### V0.2.12: Identity page

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.12` | Feature | UI | V0.2.11 |

```text
Update V0.2.12

- Added an Identity page with detected platforms, OAuth clients, scopes and tokens
- Added the lifecycle coverage matrix and privileged operations views
```

**Scope**
- New nav item "Identity" (shown when the identity profile is not empty or IAM packs are forced on), following DESIGN_SYSTEM: platform cards with confidence, OAuth clients table (flow, client auth method, PKCE, redirect URIs, scopes), scope list with broad scopes highlighted, token inspector list (masked), JML matrix (platform x stage), privileged operations and PAM retrieval lists with links to the related findings and requests.
- Sidebar badge counts identity findings only. Respect "Separated review lanes": identity findings appear on Security as well, filtered by category.

---

#### V0.2.13: IAM reporting and compliance mapping

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.13` | Feature | Reports, CLI | V0.2.12, V0.1.38 |

```text
Update V0.2.13

- Added an identity section to Markdown, HTML, JSON and SARIF reports
- Added compliance mapping for NIST, ISO 27001 and CIS controls
- Added an access review evidence export of identity inventories
```

**Scope**
- Report identity appendix: platforms, flows, clients, scopes, JML matrix, privileged operations, PAM retrievals.
- Compliance table per finding (references from V0.2.0), CLI `--compliance nist-800-53|iso-27001|cis-v8` to group the report by control.
- CSV export (`identity-inventory.csv`): endpoint class, platform, method, masked URL, request path, related findings. Useful as evidence for access reviews and audits.

---

#### V0.2.14: IAM repair fixes

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.14` | Enhancement | Repair engine | V0.2.13 |

```text
Update V0.2.14

- Added repairs for PKCE, OAuth state and tenant identifiers
- Added repairs that remove captured tokens, assertions and retrieved passwords from saved examples
- Added manual guidance for migrating deprecated OAuth grants
```

**Scope**
- Auto (not selected by default unless noted): set oauth2 helper `grant_type: authorization_code_with_pkce` and `challengeAlgorithm: S256` (medium); add `state={{$randomUUID}}` to authorize URLs (low); replace tenant identifiers with `{{tenantId}}` / `{{oktaDomain}}` style variables (medium); scrub JWTs, SAML assertions and retrieved secrets from saved responses (high, selected by default because they are live credentials).
- Manual with guidance: implicit to authorization code + PKCE, password grant to authorization code or client credentials, broad scopes to least privilege.

---

#### V0.2.15: IAM sample collections and guide

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.2.15` | Feature, Docs | Samples, docs | V0.2.14 |

```text
Update V0.2.15

- Added IAM sample collections for access management, provisioning and privileged access
- Added an IAM analysis guide
- Updated documentation and mindmaps for the identity features
```

**Scope**
- `public/samples/iam-access-management.postman_collection.json` (OAuth/OIDC flows on a fictional tenant), `iam-provisioning-governance.postman_collection.json` (SCIM, JML, access requests), `iam-privileged-access.postman_collection.json` (vault and PAM retrievals). Fictional domains (`*.example.com`, `*.example.test`), fake tokens that still match shapes only where scanners will not flag them as real (prefer runtime-built fixtures in tests and placeholder-shaped values in samples).
- `docs/IAM.md`: what PostScope checks per IAM domain, how packs auto-enable, how to read the Identity page, recommended collection conventions for IAM teams (variables, environments, vault usage, saved examples policy).
- Update functional and technical mindmaps, SECURITY detection table, README features.

---

## 5. IAM analysis reference (extra analysis elements)

This section is the catalog Track B implements. Each element lists the signals PostScope can read from a collection export, the output (finding or inventory), and the standard it relies on. Elements marked **Backlog** are valuable but not scheduled in V0.2.x.

### 5.1 Access Management (AM): authentication, federation, tokens

#### 5.1.1 OAuth 2.0 and OIDC flows

| Element | Signals in the collection | Output | Reference |
|---|---|---|---|
| Grant inventory | oauth2 helper `grant_type`, token request `grant_type` body field | Inventory (V0.2.1) | RFC 6749 |
| Implicit grant | `response_type=token` / `id_token token`, helper `implicit` | `OAUTH_IMPLICIT_GRANT` | RFC 9700 section 2.1.2 |
| Password grant (ROPC) | `grant_type=password`, helper `password_credentials` | `OAUTH_PASSWORD_GRANT` | RFC 9700 section 2.4 |
| PKCE presence and method | `code_challenge`, `code_challenge_method`, helper `challengeAlgorithm`, `grant_type authorization_code_with_pkce` | `OAUTH_PKCE_MISSING`, `OAUTH_PKCE_PLAIN` | RFC 7636, RFC 9700 section 2.1.1 |
| Redirect URI safety | `redirect_uri` / helper `redirect_uri`: scheme, wildcard, host, nested URL params | `OAUTH_REDIRECT_URI_UNSAFE` | RFC 9700 section 4.1 |
| CSRF and replay protection | `state`, `nonce` on authorize requests | `OAUTH_STATE_MISSING` | RFC 9700 section 2.1, OIDC Core 3.1.2.1 |
| Client authentication method | `client_secret` in body vs Basic header vs `client_assertion` (`private_key_jwt`) vs mTLS | `OAUTH_CLIENT_SECRET_POST`, inventory | RFC 7523, RFC 8705 |
| Tokens in URLs | `access_token`, `id_token`, `code` literals in query/fragment | `OAUTH_TOKEN_IN_URL` | RFC 9700 section 4.3 |
| Token endpoint transport | `oauth.token`, `oauth.introspect`, `oauth.revoke` over http | `OAUTH_TOKEN_ENDPOINT_HTTP` | RFC 6749 section 3.2 |
| Pushed authorization requests | `/par` endpoint usage | Inventory (positive signal) | RFC 9126 |
| Device authorization grant | `/device/code`, `urn:ietf:params:oauth:grant-type:device_code` | Inventory | RFC 8628 |
| Token exchange and delegation | `urn:ietf:params:oauth:grant-type:token-exchange`, `actor_token` | Inventory, **Backlog** rule for impersonation without `actor_token` | RFC 8693 |
| Refresh token handling | literal `refresh_token`, `offline_access` scope | Existing secret rules, scope inventory | RFC 9700 section 4.14 |
| Sender-constrained tokens | `DPoP` header, mTLS client certs configured | Inventory (positive signal) | RFC 9449, RFC 8705 |
| Discovery and keys | `/.well-known/openid-configuration`, `/jwks` | Inventory, issuer list | OIDC Discovery |

#### 5.1.2 Tokens and sessions

| Element | Signals | Output | Reference |
|---|---|---|---|
| JWT algorithm | decoded header `alg` (`none`, `HS*` on public clients) | `JWT_ALG_NONE`, inventory | RFC 8725 section 3.1 |
| Token lifetime | `exp - iat`, missing `exp` | `JWT_LONG_LIVED` | RFC 8725, NIST SP 800-63B session guidance |
| Claims exposure | `email`, `phone_number`, `name`, `groups`, `roles`, `wids`, `scp` in stored tokens | `JWT_SENSITIVE_CLAIMS` | GDPR data minimisation, OWASP API3:2023 |
| Audience and issuer | `aud`, `iss` presence and consistency with called host | Inventory, **Backlog** rule `JWT_AUDIENCE_MISMATCH` | RFC 8725 section 3.9 |
| ID token misuse | id token sent as bearer to APIs | `ID_TOKEN_AS_BEARER` | OIDC Core 2 |
| Stale tokens | expired JWT still in the export | `JWT_EXPIRED_STORED` | Hygiene |
| SAML assertions | base64 `SAMLResponse` decoding to an assertion | `SAML_ASSERTION_CAPTURED` | SAML 2.0 Core, OWASP SAML cheat sheet |
| Session cookies | saved `Set-Cookie` flags | `SESSION_COOKIE_FLAGS` | OWASP Session Management |
| Revocation and logout coverage | presence of `oauth.revoke`, `oidc.logout`, session delete calls | `TOKEN_REVOCATION_NOT_COVERED` | RFC 7009, OIDC RP-Initiated Logout |
| MFA and step-up | `acr_values`, `amr` claims, factor enrollment endpoints | Inventory, **Backlog** rule for `acr_values` downgrade | NIST SP 800-63B AAL |

#### 5.1.3 Scope and permission catalog (`OAUTH_BROAD_SCOPE`)

| Platform | Broad or high-risk scopes to flag |
|---|---|
| Generic | `*`, `all`, `admin`, `root`, scopes ending in `:admin` or `.manage` |
| Microsoft Entra / Graph | `.default` on public clients, `Directory.ReadWrite.All`, `RoleManagement.ReadWrite.Directory`, `AppRoleAssignment.ReadWrite.All`, `Application.ReadWrite.All`, `User.ReadWrite.All`, `Mail.ReadWrite` app permissions |
| Okta | `okta.users.manage`, `okta.apps.manage`, `okta.roles.manage`, `okta.policies.manage`, `okta.authorizationServers.manage` |
| Auth0 Management API | `update:users`, `delete:users`, `create:client_grants`, `update:clients`, `read:client_keys` |
| Google | `https://www.googleapis.com/auth/cloud-platform`, `admin.directory.user`, `admin.directory.rolemanagement` |
| Info only | `offline_access` (long-lived refresh tokens), `openid profile email` on machine clients |

### 5.2 Identity Governance and Administration (IGA)

#### 5.2.1 Provisioning (SCIM and connectors)

| Element | Signals | Output | Reference |
|---|---|---|---|
| SCIM resource inventory | `/scim/v2/Users`, `/Groups`, `/Bulk`, `/Schemas`, `/ServiceProviderConfig` | Inventory (V0.2.5) | RFC 7644 |
| Destructive bulk operations | `/Bulk` with `DELETE` ops | `SCIM_BULK_DESTRUCTIVE` | RFC 7644 section 3.7 |
| Unbounded queries | list calls without `filter`, `count`, `startIndex` | `SCIM_UNBOUNDED_LIST` | RFC 7644 section 3.4.2 |
| Privilege-changing PATCH | `roles`, `entitlements`, `groups`, `members`, `active` paths | `SCIM_PRIVILEGE_PATCH` | NIST 800-53 AC-2, AC-6 |
| Protocol correctness | `application/scim+json`, `schemas` URNs | `SCIM_CONTENT_TYPE`, `SCIM_SCHEMA_MISMATCH` | RFC 7643, RFC 7644 |
| Connector credentials | provisioning bearer tokens, service account passwords in connector config calls | Existing secret rules with identity tag | CIS v8 5.2 |

#### 5.2.2 Identity lifecycle (JML)

| Stage | Request patterns (examples) | Coverage output |
|---|---|---|
| Joiner | SCIM `POST /Users`; Okta `POST /api/v1/users`; Entra `POST /users`; Keycloak `POST /admin/realms/{realm}/users`; Auth0 `POST /api/v2/users` | Matrix cell, joiner count |
| Mover | SCIM `PATCH /Users/{id}`; group membership add/remove; role assignment changes | Matrix cell, privilege-change count |
| Leaver: disable | SCIM `PATCH active=false`; Okta `lifecycle/deactivate` or `suspend`; Entra `PATCH accountEnabled=false`; Keycloak `enabled=false` | `JML_LEAVER_NOT_COVERED` when missing |
| Leaver: revoke | Okta `DELETE /users/{id}/sessions`; Entra `revokeSignInSessions`; Keycloak `logout`; OAuth revoke | `LEAVER_SESSION_NOT_REVOKED` when missing |
| Leaver: delete | SCIM `DELETE /Users/{id}`; platform delete calls | `LEAVER_DELETE_WITHOUT_DISABLE` when no prior disable |

#### 5.2.3 Governance and data protection

| Element | Signals | Output | Reference |
|---|---|---|---|
| Access requests | SailPoint ISC `/v3/access-requests`, Saviynt `createrequest`, One Identity `PersonWantsOrg` | Inventory | ISO 27001:2022 A.5.18 |
| Certifications and campaigns | `/v3/certifications`, `/v3/campaigns`, decision endpoints | Inventory, `CERTIFICATION_BULK_APPROVE` | SOX ITGC, NIST AC-2(j) |
| Separation of duties | `/beta/sod-policies`, `/beta/sod-violations` | Inventory | NIST 800-53 AC-5 |
| Self-approval | approver equals requester or recipient literal | `GOVERNANCE_SELF_APPROVAL` | NIST AC-5 |
| Personal data in examples | emails, phones, national ids, IBAN, dates of birth in saved responses and bodies | `PII_IN_SAVED_RESPONSE`, `PII_IN_REQUEST_BODY` | GDPR art. 5 and 32, ISO 27001:2022 A.5.34 |
| Role and entitlement catalogs | role mining and entitlement export endpoints with saved responses | Inventory, **Backlog** rule for exported entitlement dumps | ISO 27001:2022 A.5.15 |

### 5.3 Privileged Access Management (PAM) and secrets vaults

| Element | Signals | Output | Reference |
|---|---|---|---|
| Credential retrieval capture | CyberArk PVWA `/PasswordVault/API/Accounts/{id}/Password/Retrieve`, CCP `/AIMWebService/api/Accounts`, BeyondTrust `/BeyondTrust/api/public/v3/Credentials`, Delinea `/api/v1/secrets/{id}/fields/password`, Vault `/v1/<mount>/data/...`, AWS `secretsmanager.GetSecretValue`, Azure Key Vault `/secrets/`, GCP `:access` | `PAM_RETRIEVED_SECRET_CAPTURED` | NIST 800-53 IA-5(7), CIS v8 5.4 |
| Vault and PAM session tokens | `X-Vault-Token`, `hvs.` tokens, CyberArk logon token in `Authorization`, BeyondTrust `PS-Auth` key, Delinea OAuth bearer | `PAM_VAULT_TOKEN_LITERAL` | CWE-798 |
| Root and break-glass | Vault `/sys/generate-root`, root token shapes, break-glass account naming | `PAM_ROOT_TOKEN_USAGE`, `PAM_PRIVILEGED_ACCOUNT_LITERAL` | NIST AC-2(2), CIS v8 5.4 |
| Dual control and justification | missing `reason`, `TicketingSystemName`, `TicketId` on retrieval | `PAM_RETRIEVAL_WITHOUT_REASON` | NIST AC-6(9), AU-2 |
| Checkout lifecycle | BeyondTrust `Requests` without `Checkin`, Delinea check-out without check-in | `PAM_CHECKOUT_WITHOUT_CHECKIN` | Hygiene, NIST AC-2 |
| Safe and policy administration | CyberArk `/Safes/{name}/Members`, Vault `/sys/policies/acl`, Delinea folder permissions | `PAM_SAFE_ADMIN_CHANGE` | NIST AC-6 |
| Session recording and isolation | PSM / session manager endpoints | Inventory, **Backlog** | NIST AU-14 |

### 5.4 Admin plane and cloud IAM

| Element | Signals | Output | Reference |
|---|---|---|---|
| Top-tier role grants | Okta `/api/v1/users/{id}/roles` with `SUPER_ADMIN`; Entra `roleManagement/directory/roleAssignments` with Global Administrator template id; Keycloak `role-mappings/realm` with `realm-admin`; Azure `roleAssignments` Owner or User Access Administrator; AWS `AttachUserPolicy` `AdministratorAccess` | `PRIVILEGED_ROLE_ASSIGNMENT` | NIST AC-6(5), CIS v8 6.8 |
| Authentication policy changes | Okta policies and sign-on rules; Entra `identity/conditionalAccess/policies`; Auth0 `guardian/factors`; Keycloak authentication flows | `MFA_POLICY_WEAKENING`, inventory | NIST IA-2(1), CIS v8 6.3 to 6.5 |
| Credential minting | Entra `addPassword` / `addKey`; Okta `credentials/secrets`; Keycloak `client-secret`; AWS `CreateAccessKey`; GCP `serviceAccounts.keys.create` | `CREDENTIAL_MINTING_ENDPOINT` | NIST IA-5, CIS v8 5.2 |
| Federation trust changes | Entra `federationConfiguration`, Okta IdP create, Keycloak identity providers | Inventory, **Backlog** warning rule | NIST IA-8 |

### 5.5 Workload and non-human identities

| Element | Signals | Output | Reference |
|---|---|---|---|
| Machine client inventory | `client_credentials` clients, service account keys, API tokens per platform | Inventory (V0.2.1) | CIS v8 5.5 |
| Shared client reuse | one `client_id` used across unrelated folders or platforms | **Backlog** rule `CLIENT_REUSE_ACROSS_DOMAINS` (info) | Least privilege |
| Static keys vs federation | static API keys where the platform supports workload identity federation or `private_key_jwt` | **Backlog** advisory | NIST SP 800-207 |
| Long-lived personal tokens in automation | Okta SSWS, GitHub PAT, Atlassian tokens in CI-style collections | Existing secret rules with NHI tag | CIS v8 5.2 |

### 5.6 Platform fingerprint table

| Platform | Host or path signals | Header or token signals | Profile version |
|---|---|---|---|
| Okta / Okta Workforce | `*.okta.com`, `*.oktapreview.com`, `*.okta-emea.com`, `/api/v1/`, `/oauth2/default/v1/` | `Authorization: SSWS ...` | V0.2.10 |
| Microsoft Entra ID | `login.microsoftonline.com/{tenant}`, `graph.microsoft.com`, `graph.windows.net` (retired) | client secret `Q~` format, Graph JWTs with `tid` | V0.2.10 |
| Auth0 / Okta CIAM | `*.auth0.com`, `/api/v2/`, `/oauth/token` | Management API JWTs (`aud` ending `/api/v2/`) | V0.2.10 |
| Ping Identity | `*.pingone.com`, `*.pingone.eu`, `/as/token.oauth2`, `/pf-admin-api/` | | V0.2.10 |
| ForgeRock / Ping Advanced Identity Cloud | `*.forgeblocks.com`, `/am/oauth2/`, `/openidm/` | `X-OpenAM-Username` and `X-OpenAM-Password` headers | V0.2.10 |
| Keycloak | `/realms/{realm}/protocol/openid-connect/`, `/admin/realms/`, legacy `/auth/realms/` | | V0.2.10 |
| SailPoint Identity Security Cloud / IdentityIQ | `*.api.identitynow.com`, `*.identitynow.com`, `/v3/`, `/beta/`, `/identityiq/` | PAT client credentials | V0.2.11 |
| Saviynt EIC | `*.saviyntcloud.com`, `/ECM/api/v5/` | | V0.2.11 |
| One Identity Manager | `/AppServer/api/`, `/ApiServer/` | | V0.2.11 |
| Omada | `/OData/`, `*.omada.cloud` | | V0.2.11 |
| CyberArk | `/PasswordVault/API/`, `/PasswordVault/WebServices/`, `/AIMWebService/api/`, `*.privilegecloud.cyberark.cloud`, Conjur `/authn/` | logon token in `Authorization` | V0.2.11 |
| BeyondTrust Password Safe | `/BeyondTrust/api/public/v3/` | `Authorization: PS-Auth key=...; runas=...` | V0.2.11 |
| Delinea Secret Server | `/SecretServer/api/v1/`, `*.secretservercloud.com` | | V0.2.11 |
| HashiCorp Vault | `/v1/sys/`, `/v1/auth/`, `/v1/<mount>/data/`, port `8200` | `X-Vault-Token`, `hvs.`/`hvb.` tokens | V0.2.11 |
| AWS IAM / STS | `iam.amazonaws.com`, `sts.amazonaws.com`, `secretsmanager.*.amazonaws.com` | `aws` auth helper, `X-Amz-Target` | V0.2.11 |
| Azure resource IAM | `management.azure.com/.../roleAssignments`, `*.vault.azure.net` | | V0.2.11 |
| Google Cloud IAM | `iam.googleapis.com`, `secretmanager.googleapis.com`, `admin.googleapis.com` | | V0.2.11 |

### 5.7 Compliance mapping used by IAM rules

| Framework | Controls referenced |
|---|---|
| NIST SP 800-53 Rev. 5 | AC-2 (account management), AC-5 (separation of duties), AC-6 (least privilege), AU-2 (event logging), IA-2 (identification and authentication), IA-5 (authenticator management), IA-8, SC-8 (transmission confidentiality), SC-12/13 |
| ISO/IEC 27001:2022 Annex A | A.5.15 access control, A.5.16 identity management, A.5.17 authentication information, A.5.18 access rights, A.5.34 privacy and PII, A.8.2 privileged access rights, A.8.5 secure authentication, A.8.24 use of cryptography |
| CIS Controls v8 | 5 (account management: 5.1 to 5.6), 6 (access control management: 6.1 to 6.8) |
| OWASP API Security Top 10 2023 | API1 BOLA (inventory only), API2 broken authentication, API3 property level authorization, API5 function level authorization (admin plane), API8 security misconfiguration |
| IETF | RFC 6749, 6750, 7009, 7519, 7523, 7636, 7643, 7644, 7662, 8628, 8693, 8705, 8725, 9126, 9449, 9700 |

### 5.8 Out of scope for static analysis

- Whether a token, secret or account is still valid or active (always rotate what PostScope reports).
- Whether the platform actually enforces PKCE, MFA or SoD server-side; PostScope only sees what the collection sends.
- Live calls to discovery documents or JWKS. PostScope stays offline by design; a future opt-in "fetch discovery" mode would need its own security review and is not planned.

---

## 6. Maintenance of this file

- When a version ships, change its row in section 2 to include the commit hash and move nothing else; keep the plan readable as history.
- New ideas go to a "Backlog" list under the relevant milestone with a type label; they get a version only when scheduled.
- Keep issue references (F1 to F15) stable so commits and reviews can cite them.
