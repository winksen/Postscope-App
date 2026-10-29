 `609a20c` |`47ee8f2` |`3537ebc` |`def5f38` |`da3f4dd` |`9ae0b40` |`e942d42` |`841de68` |# PostScope Roadmap

> **Audience:** the agent or engineer implementing the next releases, plus reviewers who want to know what is coming and why.
> **Historical baseline for Tracks A and B:** `Update V0.1.24` (commit `e97a99c`, 2026-10-08). Every item below was derived from a read of the code and docs at that commit.
> **Status:** Track A (V0.1.25 to V0.1.45) and Track B (V0.2.0 to V0.2.15) are implemented. The hash of the newest release is filled in by the commit that follows it. Shipped releases get their commit hash in the `Commit` column of section 2; the plan text below is kept as written for history.

> **Forward planning baseline:** V0.2.15 (`40b3703`), reviewed 2026-10-29. See [team readiness report](../docs/TEAM_READINESS_REPORT.md). Tracks C to G contain 200 planned, unimplemented releases through V0.7.39.

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
| V0.1.25 | `v0.1.25` | A1 | Chore, Docs, Bug | Version alignment, changelog, release tags, stale docs | `960c53e` |
| V0.1.26 | `v0.1.26` | A1 | Security, Bug | Audit disabled headers, query params and form fields | `caafdce` |
| V0.1.27 | `v0.1.27` | A1 | Bug | Variable-tolerant body parsing | `9526edb` |
| V0.1.28 | `v0.1.28` | A1 | Security, Bug | Descriptions, item variables, path variables, saved request bodies | `2dfc3bd` |
| V0.1.29 | `v0.1.29` | A1 | Bug | URL and auth rule accuracy | `de691a0` |
| V0.1.30 | `v0.1.30` | A1 | Bug, Enhancement | Script credential detection gaps | `22cd1b0` |
| V0.1.31 | `v0.1.31` | A1 | Security | Trusted proxy and lockout hardening | `fefcc3e` |
| V0.1.32 | `v0.1.32` | A1 | Bug | Repair, redaction and report fixes | `a414512` |
| V0.1.33 | `v0.1.33` | A2 | Enhancement | Secret pattern expansion and Basic token decoding | `7c3de25` |
| V0.1.34 | `v0.1.34` | A2 | Feature | Postman environments and globals | `ed05494` |
| V0.1.35 | `v0.1.35` | A2 | Feature | Variable integrity rules | `15fd7f0` |
| V0.1.36 | `v0.1.36` | A2 | Enhancement | Scoring model v2 | `8adccbc` |
| V0.1.37 | `v0.1.37` | A3 | Feature | Config file, baselines and suppressions | `9ac17cf` |
| V0.1.38 | `v0.1.38` | A3 | Enhancement | Precise SARIF locations, report schema, HTML report | `bc8ddff` |
| V0.1.39 | `v0.1.39` | A3 | Feature, Chore | Standalone CLI, GitHub Action, compiled server | `fd8fe06` |
| V0.1.40 | `v0.1.40` | A4 | Security, Feature | Library encryption at rest, audit log, proxy identity | `e4d04d8` |
| V0.1.41 | `v0.1.41` | A4 | Feature | Collection comparison and drift | `2308b68` |
| V0.1.42 | `v0.1.42` | A5 | Enhancement | Deep links and accessibility | `8a995e8` |
| V0.1.43 | `v0.1.43` | A5 | Enhancement | Performance: code splitting, virtualization, budgets | `8bcb7f2` |
| V0.1.44 | `v0.1.44` | A6 | Chore | Lint, format, CI hardening, browser smoke tests | `ba72975` |
| V0.1.45 | `v0.1.45` | A6 | Security, Chore | Tailwind CSS 4 migration and dependency refresh | `e6c0151` |
| V0.2.0 | `v0.2.0` | B0 | Feature | Rule packs, identity category, compliance metadata | `e8a9d96` |
| V0.2.1 | `v0.2.1` | B0 | Feature | Identity context extraction and platform fingerprinting | `4f992a7` |
| V0.2.2 | `v0.2.2` | B1 AM | Feature | OAuth 2.0 and OIDC flow rules | `6508f44` |
| V0.2.3 | `v0.2.3` | B1 AM | Feature | JWT inspection rules | `15b8afb` |
| V0.2.4 | `v0.2.4` | B1 AM | Feature | SAML, sessions and token revocation coverage | `8db8ccf` |
| V0.2.5 | `v0.2.5` | B2 IGA | Feature | SCIM 2.0 provisioning analysis | `cc74f4d` |
| V0.2.6 | `v0.2.6` | B2 IGA | Feature | Joiner, mover, leaver coverage map | `7807507` |
| V0.2.7 | `v0.2.7` | B2 IGA | Feature | Governance APIs and personal data exposure | `2b596c7` |
| V0.2.8 | `v0.2.8` | B3 PAM | Feature | PAM and secrets vault API rules | `1d88a89` |
| V0.2.9 | `v0.2.9` | B3 PAM | Feature | Privileged and admin-plane operations inventory | `5b006c2` |
| V0.2.10 | `v0.2.10` | B4 | Feature | Platform profiles: access management and CIAM | `55be46b` |
| V0.2.11 | `v0.2.11` | B4 | Feature | Platform profiles: IGA, PAM and cloud IAM | `2f250f2` |
| V0.2.12 | `v0.2.12` | B5 | Feature | Identity page | `bd1de02` |
| V0.2.13 | `v0.2.13` | B5 | Feature | IAM reporting and compliance mapping | `2af9309` |
| V0.2.14 | `v0.2.14` | B5 | Enhancement | IAM repair fixes | `cc878ec` |
| V0.2.15 | `v0.2.15` | B5 | Feature, Docs | IAM sample collections and guide | `40b3703` |
| V0.3.0 | `v0.3.0` | C1 | Security, Chore | Supported Node runtime and CI matrix | |
| V0.3.1 | `v0.3.1` | C1 | Security, Bug | Fail-closed team deployment configuration | |
| V0.3.2 | `v0.3.2` | C1 | Security | Trusted proxy identity boundary | |
| V0.3.3 | `v0.3.3` | C1 | Enhancement, Docs | Data handling summary at import | |
| V0.3.4 | `v0.3.4` | C1 | Security, Feature | Session retention and forget controls | |
| V0.3.5 | `v0.3.5` | C1 | Security, Enhancement | Consent tied to deployment policy | |
| V0.3.6 | `v0.3.6` | C1 | Security, Feature | Report and export privacy profiles | |
| V0.3.7 | `v0.3.7` | C1 | Feature, Docs | Deployment safety diagnostics | |
| V0.3.8 | `v0.3.8` | C2 | Security, Enhancement | Shared input limits and parse warnings | |
| V0.3.9 | `v0.3.9` | C2 | Security, Bug | Bounded worker fallback | |
| V0.3.10 | `v0.3.10` | C2 | Feature | Analysis cancellation and progress | |
| V0.3.11 | `v0.3.11` | C2 | Bug, Enhancement | Stale job and environment isolation | |
| V0.3.12 | `v0.3.12` | C2 | Security, Enhancement | Worker and cache disposal | |
| V0.3.13 | `v0.3.13` | C2 | Chore | Input-aware performance corpus | |
| V0.3.14 | `v0.3.14` | C2 | Enhancement, Chore | Percentile and memory budgets | |
| V0.3.15 | `v0.3.15` | C2 | Bug, Chore | Cross-platform test runner reliability | |
| V0.3.16 | `v0.3.16` | C3 | Feature | Team identity contract | |
| V0.3.17 | `v0.3.17` | C3 | Security, Feature | OIDC sign-in and session security | |
| V0.3.18 | `v0.3.18` | C3 | Feature | Project membership model | |
| V0.3.19 | `v0.3.19` | C3 | Security, Feature | Server-side role enforcement | |
| V0.3.20 | `v0.3.20` | C3 | Security | Project isolation across objects | |
| V0.3.21 | `v0.3.21` | C3 | Feature | Membership and access administration | |
| V0.3.22 | `v0.3.22` | C3 | Security, Enhancement | Session revocation and group changes | |
| V0.3.23 | `v0.3.23` | C3 | Docs, Chore | Identity-provider deployment recipes | |
| V0.3.24 | `v0.3.24` | C4 | Feature, Chore | Versioned storage schema and adapter | |
| V0.3.25 | `v0.3.25` | C4 | Feature, Enhancement | Legacy library migration | |
| V0.3.26 | `v0.3.26` | C4 | Feature | Collection versions and provenance | |
| V0.3.27 | `v0.3.27` | C4 | Enhancement | Paginated library API | |
| V0.3.28 | `v0.3.28` | C4 | Feature | Project library workspace | |
| V0.3.29 | `v0.3.29` | C4 | Enhancement | Optimistic concurrency for metadata | |
| V0.3.30 | `v0.3.30` | C4 | Feature | Verified backup and restore command | |
| V0.3.31 | `v0.3.31` | C4 | Enhancement | Storage health and capacity status | |
| V0.3.32 | `v0.3.32` | C5 | Feature | Shared policy schema and precedence | |
| V0.3.33 | `v0.3.33` | C5 | Enhancement | Policy provenance in every scan | |
| V0.3.34 | `v0.3.34` | C5 | Security, Feature | Locked team policy and preview mode | |
| V0.3.35 | `v0.3.35` | C5 | Feature | Policy import, export and validation UI | |
| V0.3.36 | `v0.3.36` | C5 | Enhancement | Environment selection manifest | |
| V0.3.37 | `v0.3.37` | C5 | Feature | Multi-environment audit matrix | |
| V0.3.38 | `v0.3.38` | C5 | Security, Enhancement | Baseline source and policy binding | |
| V0.3.39 | `v0.3.39` | C5 | Chore, Docs | Team foundation acceptance scenario | |
| V0.4.0 | `v0.4.0` | D1 | Feature | Persistent finding occurrences | |
| V0.4.1 | `v0.4.1` | D1 | Feature | Finding lifecycle | |
| V0.4.2 | `v0.4.2` | D1 | Feature | Owners and due dates | |
| V0.4.3 | `v0.4.3` | D1 | Feature | Service ownership rules | |
| V0.4.4 | `v0.4.4` | D1 | Feature | Triage inbox and saved views | |
| V0.4.5 | `v0.4.5` | D1 | Feature | Safe bulk triage | |
| V0.4.6 | `v0.4.6` | D1 | Feature | Remediation notes and external references | |
| V0.4.7 | `v0.4.7` | D1 | Feature | Finding activity timeline | |
| V0.4.8 | `v0.4.8` | D2 | Feature | Exception request workflow | |
| V0.4.9 | `v0.4.9` | D2 | Security, Feature | Independent exception approval | |
| V0.4.10 | `v0.4.10` | D2 | Enhancement | Exception expiry and revalidation | |
| V0.4.11 | `v0.4.11` | D2 | Security, Feature | Baseline change review | |
| V0.4.12 | `v0.4.12` | D2 | Security, Feature | Policy change approvals | |
| V0.4.13 | `v0.4.13` | D2 | Enhancement | Coverage and suppression transparency | |
| V0.4.14 | `v0.4.14` | D2 | Feature | Review decision snapshots | |
| V0.4.15 | `v0.4.15` | D2 | Chore | Remediation governance acceptance | |
| V0.4.16 | `v0.4.16` | D3 | Bug, Enhancement | Occurrence-level repair selection | |
| V0.4.17 | `v0.4.17` | D3 | Enhancement | Repair preview worker | |
| V0.4.18 | `v0.4.18` | D3 | Feature | Structured masked repair diff | |
| V0.4.19 | `v0.4.19` | D3 | Enhancement | Repair conflicts and prerequisites | |
| V0.4.20 | `v0.4.20` | D3 | Bug, Chore | Repair round-trip guarantees | |
| V0.4.21 | `v0.4.21` | D3 | Security, Enhancement | Post-repair safety verification | |
| V0.4.22 | `v0.4.22` | D3 | Feature | Repair patch and CLI dry run | |
| V0.4.23 | `v0.4.23` | D3 | Enhancement | Undo and immutable repaired revisions | |
| V0.4.24 | `v0.4.24` | D4 | Enhancement | Rule explanations and confidence | |
| V0.4.25 | `v0.4.25` | D4 | Chore | Labeled detection quality corpus | |
| V0.4.26 | `v0.4.26` | D4 | Enhancement | Unknown and partial analysis states | |
| V0.4.27 | `v0.4.27` | D4 | Enhancement | Script analysis accuracy | |
| V0.4.28 | `v0.4.28` | D4 | Feature | Rule-specific tuning controls | |
| V0.4.29 | `v0.4.29` | D4 | Enhancement | IAM context overrides | |
| V0.4.30 | `v0.4.30` | D4 | Feature | General API collection quality pack | |
| V0.4.31 | `v0.4.31` | D4 | Docs, Chore | Rule maintenance and regression policy | |
| V0.4.32 | `v0.4.32` | D5 | Enhancement | Guided first finding workflow | |
| V0.4.33 | `v0.4.33` | D5 | Enhancement | Accessible triage and repair journeys | |
| V0.4.34 | `v0.4.34` | D5 | Enhancement | Readable dense evidence | |
| V0.4.35 | `v0.4.35` | D5 | Feature | Persistent authorized review links | |
| V0.4.36 | `v0.4.36` | D5 | Enhancement | Comparison ambiguity and policy awareness | |
| V0.4.37 | `v0.4.37` | D5 | Feature | Team review report | |
| V0.4.38 | `v0.4.38` | D5 | Feature, Docs | Secret rotation handoff | |
| V0.4.39 | `v0.4.39` | D5 | Chore, Docs | Team workflow pilot checkpoint | |
| V0.5.0 | `v0.5.0` | E1 | Security, Feature | Scoped CI service accounts | |
| V0.5.1 | `v0.5.1` | E1 | Security, Feature | Validated scan ingestion schema | |
| V0.5.2 | `v0.5.2` | E1 | Feature | Authenticated CI result ingestion | |
| V0.5.3 | `v0.5.3` | E1 | Security, Enhancement | Trusted gate provenance | |
| V0.5.4 | `v0.5.4` | E1 | Enhancement | Single-pass CLI report generation | |
| V0.5.5 | `v0.5.5` | E1 | Feature | Changed-file and monorepo scanning | |
| V0.5.6 | `v0.5.6` | E1 | Security, Enhancement | Fork-safe pull request reporting | |
| V0.5.7 | `v0.5.7` | E1 | Chore, Docs | Reusable CI integration fixtures | |
| V0.5.8 | `v0.5.8` | E2 | Feature, Chore | Format adapter contract | |
| V0.5.9 | `v0.5.9` | E2 | Feature | Offline OpenAPI JSON and YAML input | |
| V0.5.10 | `v0.5.10` | E2 | Security, Feature | Local reference resolution | |
| V0.5.11 | `v0.5.11` | E2 | Feature | Operation and collection matching | |
| V0.5.12 | `v0.5.12` | E2 | Feature | Declared authentication drift | |
| V0.5.13 | `v0.5.13` | E2 | Feature | Request and example contract checks | |
| V0.5.14 | `v0.5.14` | E2 | Feature | Contract and collection change review | |
| V0.5.15 | `v0.5.15` | E2 | Enhancement, Docs | Contract evidence and Spectral handoff | |
| V0.5.16 | `v0.5.16` | E3 | Feature | Bruno static import adapter | |
| V0.5.17 | `v0.5.17` | E3 | Enhancement | Bruno folder and environment semantics | |
| V0.5.18 | `v0.5.18` | E3 | Enhancement | Bruno evidence and repair boundaries | |
| V0.5.19 | `v0.5.19` | E3 | Chore, Docs | Adapter compatibility corpus | |
| V0.5.20 | `v0.5.20` | E3 | Feature | Opt-in Postman source retrieval | |
| V0.5.21 | `v0.5.21` | E3 | Security | Retrieval network and credential safety | |
| V0.5.22 | `v0.5.22` | E3 | Enhancement | Source freshness and change metadata | |
| V0.5.23 | `v0.5.23` | E3 | Docs, Chore | Repeatable source-to-CI recipe | |
| V0.5.24 | `v0.5.24` | E4 | Feature | Versioned integration event contract | |
| V0.5.25 | `v0.5.25` | E4 | Feature | Durable delivery outbox | |
| V0.5.26 | `v0.5.26` | E4 | Security, Feature | Signed webhook delivery | |
| V0.5.27 | `v0.5.27` | E4 | Feature | Integration administration and diagnostics | |
| V0.5.28 | `v0.5.28` | E4 | Feature | GitHub issue handoff | |
| V0.5.29 | `v0.5.29` | E4 | Feature | GitLab issue handoff | |
| V0.5.30 | `v0.5.30` | E4 | Feature | Notification filtering and digests | |
| V0.5.31 | `v0.5.31` | E4 | Chore, Docs | Connector acceptance and outage drill | |
| V0.5.32 | `v0.5.32` | E5 | Feature | Declarative custom rule schema | |
| V0.5.33 | `v0.5.33` | E5 | Feature | Custom rule preview and fixtures | |
| V0.5.34 | `v0.5.34` | E5 | Feature | Versioned rule pack distribution | |
| V0.5.35 | `v0.5.35` | E5 | Enhancement | Organization policy overlays | |
| V0.5.36 | `v0.5.36` | E5 | Feature | Editor diagnostics workflow | |
| V0.5.37 | `v0.5.37` | E5 | Docs, Chore | Pack author contribution guide | |
| V0.5.38 | `v0.5.38` | E5 | Feature | Integration onboarding wizard | |
| V0.5.39 | `v0.5.39` | E5 | Chore, Docs | Integration pilot checkpoint | |
| V0.6.0 | `v0.6.0` | F1 | Chore | Performance profile and hotspot report | |
| V0.6.1 | `v0.6.1` | F1 | Enhancement | Indexed request and finding lookups | |
| V0.6.2 | `v0.6.2` | F1 | Enhancement | Bounded evidence and identity rendering | |
| V0.6.3 | `v0.6.3` | F1 | Enhancement | Reduced raw-data duplication | |
| V0.6.4 | `v0.6.4` | F1 | Enhancement | Bounded batch CLI execution | |
| V0.6.5 | `v0.6.5` | F1 | Enhancement | Large report generation | |
| V0.6.6 | `v0.6.6` | F1 | Enhancement | Stable baseline and comparison scaling | |
| V0.6.7 | `v0.6.7` | F1 | Chore | User-visible performance acceptance | |
| V0.6.8 | `v0.6.8` | F2 | Security, Enhancement | Durable audit event writes | |
| V0.6.9 | `v0.6.9` | F2 | Enhancement | Complete audit coverage | |
| V0.6.10 | `v0.6.10` | F2 | Security, Feature | Audit integrity and external export | |
| V0.6.11 | `v0.6.11` | F2 | Security, Enhancement | Encryption coverage and key rotation | |
| V0.6.12 | `v0.6.12` | F2 | Feature | Project retention policies | |
| V0.6.13 | `v0.6.13` | F2 | Security, Feature | Deletion and data export lifecycle | |
| V0.6.14 | `v0.6.14` | F2 | Enhancement | Crash recovery and corruption tools | |
| V0.6.15 | `v0.6.15` | F2 | Chore, Docs | Restore and rotation failure drills | |
| V0.6.16 | `v0.6.16` | F3 | Docs, Security | Updated product threat model | |
| V0.6.17 | `v0.6.17` | F3 | Security, Chore | Authorization regression matrix | |
| V0.6.18 | `v0.6.18` | F3 | Security, Chore | Parser and rule fuzzing | |
| V0.6.19 | `v0.6.19` | F3 | Security, Chore | Export injection and leakage corpus | |
| V0.6.20 | `v0.6.20` | F3 | Security, Chore | HTTP and session abuse tests | |
| V0.6.21 | `v0.6.21` | F3 | Security, Chore | Dependency and container security coverage | |
| V0.6.22 | `v0.6.22` | F3 | Docs, Security | Independent security assessment package | |
| V0.6.23 | `v0.6.23` | F3 | Security, Bug | Security finding remediation verification | |
| V0.6.24 | `v0.6.24` | F4 | Feature | Redacted operational metrics | |
| V0.6.25 | `v0.6.25` | F4 | Enhancement | Structured errors and correlation | |
| V0.6.26 | `v0.6.26` | F4 | Docs, Enhancement | Readiness and alert runbooks | |
| V0.6.27 | `v0.6.27` | F4 | Feature | Diagnostic support bundle | |
| V0.6.28 | `v0.6.28` | F4 | Feature | Scan and policy quality trends | |
| V0.6.29 | `v0.6.29` | F4 | Feature | Portfolio ownership and freshness view | |
| V0.6.30 | `v0.6.30` | F4 | Enhancement | Notification and queue health | |
| V0.6.31 | `v0.6.31` | F4 | Docs, Chore | Operational service objectives | |
| V0.6.32 | `v0.6.32` | F5 | Security, Enhancement | Single-writer storage protection | |
| V0.6.33 | `v0.6.33` | F5 | Enhancement, Docs | Production Compose deployment | |
| V0.6.34 | `v0.6.34` | F5 | Feature, Docs | Single-replica Kubernetes deployment | |
| V0.6.35 | `v0.6.35` | F5 | Chore, Docs | Offline deployment verification | |
| V0.6.36 | `v0.6.36` | F5 | Enhancement | Upgrade and rollback compatibility | |
| V0.6.37 | `v0.6.37` | F5 | Chore | Capacity and contention load tests | |
| V0.6.38 | `v0.6.38` | F5 | Chore | Long-running service soak | |
| V0.6.39 | `v0.6.39` | F5 | Chore, Docs | Operator acceptance checkpoint | |
| V0.7.0 | `v0.7.0` | G1 | Enhancement | Role-oriented start screen | |
| V0.7.1 | `v0.7.1` | G1 | Feature | Small-team starter configuration | |
| V0.7.2 | `v0.7.2` | G1 | Docs | Startup adoption guide and samples | |
| V0.7.3 | `v0.7.3` | G1 | Docs | Platform-team adoption guide | |
| V0.7.4 | `v0.7.4` | G1 | Feature, Docs | Community publishing workflow | |
| V0.7.5 | `v0.7.5` | G1 | Enhancement | Everyday project navigation | |
| V0.7.6 | `v0.7.6` | G1 | Enhancement | Actionable empty and error states | |
| V0.7.7 | `v0.7.7` | G1 | Enhancement | Evidence-based UX refinement | |
| V0.7.8 | `v0.7.8` | G2 | Chore | Complete accessibility inventory | |
| V0.7.9 | `v0.7.9` | G2 | Enhancement | Screen-reader workflow verification | |
| V0.7.10 | `v0.7.10` | G2 | Enhancement | Keyboard and focus consistency | |
| V0.7.11 | `v0.7.11` | G2 | Enhancement | Zoom and responsive review layouts | |
| V0.7.12 | `v0.7.12` | G2 | Enhancement | Contrast and non-color status cues | |
| V0.7.13 | `v0.7.13` | G2 | Enhancement | Reduced motion and loading behavior | |
| V0.7.14 | `v0.7.14` | G2 | Enhancement, Docs | Clear terminology and localization readiness | |
| V0.7.15 | `v0.7.15` | G2 | Chore | Cross-browser and manual accessibility gate | |
| V0.7.16 | `v0.7.16` | G3 | Docs | Public product documentation | |
| V0.7.17 | `v0.7.17` | G3 | Docs | Discoverable security policy | |
| V0.7.18 | `v0.7.18` | G3 | Docs, Chore | Contributor onboarding | |
| V0.7.19 | `v0.7.19` | G3 | Docs | Project governance and conduct | |
| V0.7.20 | `v0.7.20` | G3 | Chore, Docs | Issue and pull request templates | |
| V0.7.21 | `v0.7.21` | G3 | Docs | Contribution map and starter tasks | |
| V0.7.22 | `v0.7.22` | G3 | Docs | Support and compatibility policy | |
| V0.7.23 | `v0.7.23` | G3 | Docs, Chore | Maintainer sustainability checklist | |
| V0.7.24 | `v0.7.24` | G4 | Feature, Chore | CLI package boundary | |
| V0.7.25 | `v0.7.25` | G4 | Chore | Clean-install artifact tests | |
| V0.7.26 | `v0.7.26` | G4 | Chore | Container release matrix | |
| V0.7.27 | `v0.7.27` | G4 | Security, Chore | Software bill of materials and notices | |
| V0.7.28 | `v0.7.28` | G4 | Security, Chore | Signed release provenance | |
| V0.7.29 | `v0.7.29` | G4 | Chore | Rehearsable release workflow | |
| V0.7.30 | `v0.7.30` | G4 | Docs, Chore | Upgrade documentation from V0.2.15 | |
| V0.7.31 | `v0.7.31` | G4 | Chore | Release artifact recovery rehearsal | |
| V0.7.32 | `v0.7.32` | G5 | Docs | Private beta evaluation protocol | |
| V0.7.33 | `v0.7.33` | G5 | Chore, Enhancement | Startup and small-team beta review | |
| V0.7.34 | `v0.7.34` | G5 | Chore, Enhancement | Platform and community beta review | |
| V0.7.35 | `v0.7.35` | G5 | Chore | Detection and repair qualification | |
| V0.7.36 | `v0.7.36` | G5 | Security, Chore | Security and privacy sign-off evidence | |
| V0.7.37 | `v0.7.37` | G5 | Chore | Reliability and performance qualification | |
| V0.7.38 | `v0.7.38` | G5 | Chore, Docs | Documentation and usability qualification | |
| V0.7.39 | `v0.7.39` | G5 | Chore, Docs | V1.0 readiness decision and release manifest | |

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

## 6. Team-readiness execution plan

This extends shipped features rather than replacing them. Gap IDs R01 to R24 refer to the readiness report. Each release below uses the existing one-version-per-commit convention, metadata table, commit-message template, scope and acceptance layout. Empty commit cells mean unimplemented. Past-tense bullets are templates for future commits.

| Track | Minor | Planned versions | Commits | Outcome |
|---|---|---|---|---|
| C | 0.3.x | V0.3.0 to V0.3.39 | 40 | A small team can safely deploy PostScope, sign in through its existing identity provider, keep isolated projects and reproduce a governed scan. |
| D | 0.4.x | V0.4.0 to V0.4.39 | 40 | Developers and reviewers can assign, fix, verify and close findings with defensible exceptions and readable evidence. |
| E | 0.5.x | V0.5.0 to V0.5.39 | 40 | Teams can run policy in Git workflows, inspect collection-to-contract drift and send redacted results to the tools they already use. |
| F | 0.6.x | V0.6.0 to V0.6.39 | 40 | Operators can support the declared team workload, recover data, investigate failures and maintain a hardened deployment. |
| G | 0.7.x | V0.7.0 to V0.7.39 | 40 | A new team can adopt the product without maintainer assistance, contributors can sustain it, and a frozen release candidate has complete launch evidence. |
| Total | | | **200** | Before V1.0.0 |

Execute C, D, E, F, then G. Each entry depends on its predecessor to preserve linear history; this transitive dependency includes the earlier functional foundations. Renumber unshipped versions together if priorities change. A commit may require several engineering days: these are deliverables, not calendar estimates. Split oversized work into additional patch versions rather than bundling unrelated changes. Estimate each milestone before implementation.

P0 means required before advertising the associated security or team capability; P1 means a core adoption outcome. Keep incomplete team features behind explicit capability flags until their authorization, privacy and migration checks pass. Security defects in enabled features preempt the sequence. Preserve a working browser-only app and offline CLI throughout.

The proposed team architecture is one organization with isolated projects, authenticated through OIDC or a verified proxy, and a transactional SQLite metadata store behind a versioned adapter. Validate this decision in C4 and record an ADR before adding dependencies. Preserve current encrypted collection payloads and provide migration. Local analysis requires neither a database nor an account. Network retrieval and integrations are explicit optional operations; imported scripts and API requests are never executed.

For every release, apply section 0.1 plus relevant lint, style, unit, integration and browser checks. New endpoints require denied-role and cross-project tests; new export surfaces require leakage tests; storage changes require interrupted-migration and restore evidence. Documentation-only work uses verified commands and walkthroughs. Do not add empty commits to satisfy a count.

V0.8.x and V0.9.x remain unallocated. If qualification finds more work, extend V0.7.x for fixes or plan additional minors in this same format. V1.0.0 depends on evidence, not reaching a version number.

---

## 7. Track C: Trustworthy team foundation

**Outcome:** A small team can safely deploy PostScope, sign in through its existing identity provider, keep isolated projects and reproduce a governed scan.

### Milestone C1: Supported deployment and explicit privacy

**Priority:** P0. **Readiness gaps:** R01, R02, R03.

#### V0.3.0: Supported Node runtime and CI matrix

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.0` | Security, Chore | Runtime, server hardening, privacy UX | V0.2.15 |

```text
Update V0.3.0

- Updated the server, CLI and CI to supported Node releases
```

**Scope**

- Replace Node 20 defaults in Dockerfile, action.yml, engines, build targets and examples; select supported LTS lines from the release schedule at implementation time.

**Acceptance**

- Build, compiled CLI and container smoke checks pass on the declared minimum and current supported LTS; no advertised path requires an EOL runtime.

---

#### V0.3.1: Fail-closed team deployment configuration

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.1` | Security, Bug | Runtime, server hardening, privacy UX | V0.3.0 |

```text
Update V0.3.1

- Rejected incomplete authentication and unsafe team deployment settings
```

**Scope**

- Validate runtime settings before listening; partial Basic credentials fail startup; team storage requires authenticated mode or an explicit documented isolated-network override.

**Acceptance**

- Partial credentials and accidental unauthenticated team storage cannot start; static mode still works without credentials.

---

#### V0.3.2: Trusted proxy identity boundary

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.2` | Security | Runtime, server hardening, privacy UX | V0.3.1 |

```text
Update V0.3.2

- Restricted identity headers to configured trusted proxy peers
```

**Scope**

- Separate proxy IP trust from identity trust in server/security.ts; require an allowed socket peer and stripped identity headers; reject malformed or missing actors in team mode.

**Acceptance**

- A direct request with forged user or group headers cannot acquire an identity; documented reverse-proxy fixtures succeed.

---

#### V0.3.3: Data handling summary at import

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.3` | Enhancement, Docs | Runtime, server hardening, privacy UX | V0.3.2 |

```text
Update V0.3.3

- Explained browser memory, session storage and server uploads before import
```

**Scope**

- Show the actual off, hybrid or on policy and environment-file behavior in DropZone; correct README refresh claims using deploymentConfig.ts.

**Acceptance**

- A mode matrix browser test verifies the displayed destination and persistence match requests and storage writes in all modes.

---

#### V0.3.4: Session retention and forget controls

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.4` | Security, Feature | Runtime, server hardening, privacy UX | V0.3.3 |

```text
Update V0.3.4

- Added explicit session retention and a complete forget action
```

**Scope**

- Make raw collection and environment session retention a separate opt-in or enforced policy with visible expiry; clear stored data, selected request and revealed values on forget.

**Acceptance**

- A secret sentinel disappears from app-owned storage after forget or expiry; disabled retention survives reload without restoring input.

---

#### V0.3.5: Consent tied to deployment policy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.5` | Security, Enhancement | Runtime, server hardening, privacy UX | V0.3.4 |

```text
Update V0.3.5

- Renewed upload consent when the destination or storage policy changes
```

**Scope**

- Bind hybrid upload consent to origin and a policy digest including redaction and retention; show forced team logging as an operator policy.

**Acceptance**

- Changing destination or policy invalidates old consent; incognito never uploads; unchanged consent does not produce repeated prompts.

---

#### V0.3.6: Report and export privacy profiles

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.6` | Security, Feature | Runtime, server hardening, privacy UX | V0.3.5 |

```text
Update V0.3.6

- Added separate internal and external sharing profiles
```

**Scope**

- Centralize report redaction for credential evidence and sensitive names, hosts, paths and IAM metadata; let external profiles replace identifiers while retaining useful rule context.

**Acceptance**

- Seeded secrets and configured internal identifiers are absent from every external JSON, HTML, Markdown, SARIF and CSV export.

---

#### V0.3.7: Deployment safety diagnostics

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.7` | Feature, Docs | Runtime, server hardening, privacy UX | V0.3.6 |

```text
Update V0.3.7

- Added a redacted diagnostic command and deployment checklist
```

**Scope**

- Expose effective nonsecret security settings and actionable errors through a CLI doctor command; distinguish browser-only, isolated team and authenticated team deployment recipes.

**Acceptance**

- Doctor never prints keys or passwords and flags unsafe examples; a clean-machine operator follows each supported recipe successfully.

---

### Milestone C2: Bounded analysis and resource lifecycle

**Priority:** P0. **Readiness gaps:** R15, R23.

#### V0.3.8: Shared input limits and parse warnings

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.8` | Security, Enhancement | Browser worker, parser, CLI | V0.3.7 |

```text
Update V0.3.8

- Applied consistent byte and nesting limits to every import path
```

**Scope**

- Unify browser file, paste, environment, CLI and server guards; validate depth and structural limits with explicit unsupported-content warnings.

**Acceptance**

- Equivalent oversized or deeply nested inputs fail with a stable error before expensive work; Unicode sizes are measured in bytes.

---

#### V0.3.9: Bounded worker fallback

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.9` | Security, Bug | Browser worker, parser, CLI | V0.3.8 |

```text
Update V0.3.9

- Prevented large imports from blocking the page when workers are unavailable
```

**Scope**

- In analyzeCollection.ts allow only documented small-input fallback or show recovery guidance; do not imply a timer can interrupt synchronous main-thread parsing.

**Acceptance**

- With Worker disabled, a large fixture is refused promptly and navigation stays usable; a small supported file still analyzes.

---

#### V0.3.10: Analysis cancellation and progress

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.10` | Feature | Browser worker, parser, CLI | V0.3.9 |

```text
Update V0.3.10

- Added cancellable analysis with meaningful progress states
```

**Scope**

- Add job-scoped cancel and parse, audit, score stages; recycle the responsible worker without cancelling unrelated reference jobs.

**Acceptance**

- Cancelling a large import returns control within one second on the reference machine and permits a new import without stale results.

---

#### V0.3.11: Stale job and environment isolation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.11` | Bug, Enhancement | Browser worker, parser, CLI | V0.3.10 |

```text
Update V0.3.11

- Kept rapid imports and environment changes attached to the right result
```

**Scope**

- Use generation IDs for main and reference jobs, options and environment selections; ignore completed work superseded by newer input.

**Acceptance**

- Rapid import, compare and environment-switch tests never display findings or scores for the wrong collection or policy.

---

#### V0.3.12: Worker and cache disposal

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.12` | Security, Enhancement | Browser worker, parser, CLI | V0.3.11 |

```text
Update V0.3.12

- Released analysis data when a collection is closed
```

**Scope**

- Add explicit disposal for parsedBySlot, fallbackFull, pending jobs and compare state; reset on forget, logout and project switch.

**Acceptance**

- Heap-retention probes show no app-held prior raw inputs after disposal; reopening starts a fresh job rather than reusing stale cache.

---

#### V0.3.13: Input-aware performance corpus

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.13` | Chore | Browser worker, parser, CLI | V0.3.12 |

```text
Update V0.3.13

- Added representative IAM and hostile-input performance fixtures
```

**Scope**

- Extend scripts/bench.mjs with small, 6000-request, IAM-heavy, deep, long-body and many-environment cases; keep secrets synthetic and record bytes and rules executed.

**Acceptance**

- The corpus runs deterministically with each intended pack enabled; a slow pathological case is reported individually rather than hidden in an average.

---

#### V0.3.14: Percentile and memory budgets

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.14` | Enhancement, Chore | Browser worker, parser, CLI | V0.3.13 |

```text
Update V0.3.14

- Measured typical latency, slow runs and memory alongside throughput
```

**Scope**

- Retain current budgets while recording median, p95, peak RSS or supported heap measurements, worker transfer and end-to-end browser timings on a named reference profile.

**Acceptance**

- A deliberately introduced latency or memory regression fails the appropriate budget; measurements disclose sample count, hardware and warm/cold state.

---

#### V0.3.15: Cross-platform test runner reliability

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.15` | Bug, Chore | Browser worker, parser, CLI | V0.3.14 |

```text
Update V0.3.15

- Made test execution and subprocess handling reliable on supported platforms
```

**Scope**

- Investigate the readiness-run failures before changing assertions; bound concurrency and subprocess timeouts; preserve required Windows environment variables; publish platform-specific failure diagnostics.

**Acceptance**

- The existing suite passes on Windows and Linux with no unexplained skips; a hung subprocess fails with a useful error and exits cleanly.

---

### Milestone C3: Identity and project permissions

**Priority:** P0. **Readiness gaps:** R05, R06.

#### V0.3.16: Team identity contract

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.16` | Feature | Server identity, authorization, project UI | V0.3.15 |

```text
Update V0.3.16

- Added stable team identities without requiring accounts for local scans
```

**Scope**

- Define actor IDs, trusted identity claims and session lifecycle; retain browser-only and CLI paths; use supported OIDC middleware or a documented authenticated proxy rather than hand-written token validation.

**Acceptance**

- Team APIs require a resolved actor while offline analysis has no login requirement; identity contract tests cover missing and malformed claims.

---

#### V0.3.17: OIDC sign-in and session security

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.17` | Security, Feature | Server identity, authorization, project UI | V0.3.16 |

```text
Update V0.3.17

- Added OIDC sign-in for self-hosted teams
```

**Scope**

- Implement authorization code with PKCE, state and nonce, strict issuer and audience checks, secure cookies, CSRF protection, logout and session expiry using a maintained library.

**Acceptance**

- Replay, issuer mismatch, missing state and expired sessions are rejected; two reference identity-provider configurations complete login and logout.

---

#### V0.3.18: Project membership model

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.18` | Feature | Server identity, authorization, project UI | V0.3.17 |

```text
Update V0.3.18

- Added projects and explicit membership
```

**Scope**

- Introduce organization-local project IDs, memberships and administrator bootstrap; do not infer access from collection names or user-supplied headers.

**Acceptance**

- New projects are private to authorized members; unassigned users cannot enumerate them; first-admin setup cannot be claimed remotely twice.

---

#### V0.3.19: Server-side role enforcement

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.19` | Security, Feature | Server identity, authorization, project UI | V0.3.18 |

```text
Update V0.3.19

- Enforced viewer, contributor, reviewer and administrator permissions
```

**Scope**

- Centralize deny-by-default authorization for list, read, upload, delete, export, policy and membership operations; define a documented permission matrix.

**Acceptance**

- Every operation has positive and negative role tests, including direct API calls that bypass the UI.

---

#### V0.3.20: Project isolation across objects

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.20` | Security | Server identity, authorization, project UI | V0.3.19 |

```text
Update V0.3.20

- Isolated collections, versions, findings and exports by project
```

**Scope**

- Require project scope on data access and nested resources; validate parent-child relationships before lookup, deduplication or export.

**Acceptance**

- A member of project A cannot read, infer counts for, modify or download project B objects using guessed IDs or cross-project references.

---

#### V0.3.21: Membership and access administration

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.21` | Feature | Server identity, authorization, project UI | V0.3.20 |

```text
Update V0.3.21

- Added a team administration screen for access changes
```

**Scope**

- Let authorized admins map existing identity-provider users or groups to project roles; include audit events and last-administrator protection.

**Acceptance**

- An admin can onboard and remove a member without file edits; unauthorized changes and removal of the only admin are refused.

---

#### V0.3.22: Session revocation and group changes

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.22` | Security, Enhancement | Server identity, authorization, project UI | V0.3.21 |

```text
Update V0.3.22

- Applied access removal to active sessions
```

**Scope**

- Bound claim caching, revoke sessions after membership removal, document group-refresh latency and clear client state on authorization loss.

**Acceptance**

- A removed member loses API access within the declared maximum interval and cannot keep cached project data visible after the app receives revocation.

---

#### V0.3.23: Identity-provider deployment recipes

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.23` | Docs, Chore | Server identity, authorization, project UI | V0.3.22 |

```text
Update V0.3.23

- Added tested Keycloak and Entra-compatible team setup recipes
```

**Scope**

- Provide minimal OIDC or proxy examples, TLS and callback settings, logout behavior and troubleshooting without committing secrets; keep provider-specific setup optional.

**Acceptance**

- Maintainers reproduce sign-in, project restriction and deprovisioning against the two recipes; screenshots and commands match actual behavior.

---

### Milestone C4: Durable project records

**Priority:** P0. **Readiness gaps:** R07, R16.

#### V0.3.24: Versioned storage schema and adapter

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.24` | Feature, Chore | Storage, migrations, API, library UI | V0.3.23 |

```text
Update V0.3.24

- Added a transactional metadata store for team records
```

**Scope**

- Introduce a versioned storage interface and SQLite metadata for one service instance; keep static deployments dependency-free and existing encrypted collection payloads separate.

**Acceptance**

- Adapter contract tests cover transactions and schema versions; unsupported future schemas fail before writes; no multi-instance support is implied.

---

#### V0.3.25: Legacy library migration

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.25` | Feature, Enhancement | Storage, migrations, API, library UI | V0.3.24 |

```text
Update V0.3.25

- Migrated existing library records into a default project safely
```

**Scope**

- Create a dry-run migration with inventory, backups, ownership assignment and verification; preserve encryption and old IDs; never delete original files before verified completion.

**Acceptance**

- Plaintext and encrypted V0.2.15 fixtures migrate with matching counts and content; interruption resumes or rolls back without duplicate records.

---

#### V0.3.26: Collection versions and provenance

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.26` | Feature | Storage, migrations, API, library UI | V0.3.25 |

```text
Update V0.3.26

- Added immutable collection revisions with source information
```

**Scope**

- Separate a logical collection from immutable revisions; record importer, timestamp, source path or revision, engine version and environment manifest without secret values.

**Acceptance**

- Two revisions retain distinct histories; deduplication never crosses project access boundaries; provenance remains available after a rename.

---

#### V0.3.27: Paginated library API

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.27` | Enhancement | Storage, migrations, API, library UI | V0.3.26 |

```text
Update V0.3.27

- Added stable pagination, search and sorting to the library
```

**Scope**

- Replace unbounded collection listing with scoped cursor pagination and indexed metadata queries; provide an explicit compatibility period for the old endpoint.

**Acceptance**

- Paging through inserts and deletions does not silently skip or repeat records; unauthorized entries never affect result counts.

---

#### V0.3.28: Project library workspace

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.28` | Feature | Storage, migrations, API, library UI | V0.3.27 |

```text
Update V0.3.28

- Added a project library with search, tags and revision history
```

**Scope**

- Replace the all-items modal as the main team entry point; show owner, latest scan and saved revisions while keeping quick-open available.

**Acceptance**

- A teammate locates a tagged collection and opens an older revision using keyboard navigation; empty and unauthorized states explain the next action.

---

#### V0.3.29: Optimistic concurrency for metadata

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.29` | Enhancement | Storage, migrations, API, library UI | V0.3.28 |

```text
Update V0.3.29

- Prevented concurrent edits from silently overwriting each other
```

**Scope**

- Add revision tokens to names, tags, membership and policy metadata changes; surface conflicts with reload and deliberate retry options.

**Acceptance**

- Two editors changing the same revision receive one success and one conflict; retry preserves both intentional edits without lost updates.

---

#### V0.3.30: Verified backup and restore command

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.30` | Feature | Storage, migrations, API, library UI | V0.3.29 |

```text
Update V0.3.30

- Added backup manifests and verified restores
```

**Scope**

- Back up metadata, encrypted payloads and audit state consistently; keep keys separate; restore into a fresh location with integrity checks and a dry run.

**Acceptance**

- A restore of a mixed-version fixture matches IDs and counts; wrong keys and corrupt manifests fail without changing the active store.

---

#### V0.3.31: Storage health and capacity status

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.31` | Enhancement | Storage, migrations, API, library UI | V0.3.30 |

```text
Update V0.3.31

- Separated liveness from storage readiness
```

**Scope**

- Add bounded readiness checks for schema, encryption, disk capacity and audit availability; expose redacted status to operators and useful save errors to users.

**Acceptance**

- A live process with an invalid key or read-only volume reports not ready; probe calls remain bounded and reveal no secret settings.

---

### Milestone C5: Reproducible policy and inputs

**Priority:** P0. **Readiness gaps:** R04, R11, R19.

#### V0.3.32: Shared policy schema and precedence

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.32` | Feature | Policy, reports, environments | V0.3.31 |

```text
Update V0.3.32

- Added one versioned policy model for browser and CLI
```

**Scope**

- Extend projectConfig.ts with explicit precedence for deployment minimums, project policy and permitted local preferences; retain a migration path for existing .postscope.json files.

**Acceptance**

- The same input and effective policy produce identical browser and CLI findings; unknown settings and invalid migrations fail visibly.

---

#### V0.3.33: Policy provenance in every scan

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.33` | Enhancement | Policy, reports, environments | V0.3.32 |

```text
Update V0.3.33

- Recorded the engine and effective policy behind each result
```

**Scope**

- Attach policy digest, ruleset version, active packs, input revision and environment manifest to reports and scan summaries; never embed environment values.

**Acceptance**

- Reviewers can distinguish scans made under different rules or environments and reproduce an identical result from an approved fixture.

---

#### V0.3.34: Locked team policy and preview mode

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.34` | Security, Feature | Policy, reports, environments | V0.3.33 |

```text
Update V0.3.34

- Separated enforced policy results from personal experiments
```

**Scope**

- Lock minimum rules and severity constraints in governed mode; label local overrides as previews; only trusted CI or server-verified runs can satisfy a release gate.

**Acceptance**

- Disabling a critical rule in browser storage cannot change the recorded governed result or satisfy an approval gate.

---

#### V0.3.35: Policy import, export and validation UI

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.35` | Feature | Policy, reports, environments | V0.3.34 |

```text
Update V0.3.35

- Added a policy editor with validation and preview
```

**Scope**

- Allow authorized policy authors to edit structured settings, import .postscope.json and inspect a change summary before publishing; show inherited versus editable settings.

**Acceptance**

- An invalid rule ID never saves; exported policy round-trips; a user can see which findings change before adoption.

---

#### V0.3.36: Environment selection manifest

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.36` | Enhancement | Policy, reports, environments | V0.3.35 |

```text
Update V0.3.36

- Made environment selection explicit and reproducible
```

**Scope**

- Represent ordered collection, environment and globals inputs with nonsecret identifiers and digests; make comparison-side environment choices explicit.

**Acceptance**

- CLI and browser scans using the same manifest agree; reports disclose unresolved inputs and never silently select a different environment.

---

#### V0.3.37: Multi-environment audit matrix

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.37` | Feature | Policy, reports, environments | V0.3.36 |

```text
Update V0.3.37

- Added a summary of findings across selected environments
```

**Scope**

- Run one collection against explicitly selected environments with bounded scheduling and separate outcomes; label unresolved runtime variables as unknown.

**Acceptance**

- A transport issue present only in staging appears in staging results; one failed environment does not disappear behind an overall passing score.

---

#### V0.3.38: Baseline source and policy binding

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.38` | Security, Enhancement | Policy, reports, environments | V0.3.37 |

```text
Update V0.3.38

- Bound baselines to collection identity and analysis policy
```

**Scope**

- Version baseline metadata to include project or logical source, engine compatibility and policy digest; preserve legacy reading with an explicit unbound warning.

**Acceptance**

- A baseline from a different collection cannot silently suppress findings; policy changes require an intentional rebase with a readable delta.

---

#### V0.3.39: Team foundation acceptance scenario

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.3.39` | Chore, Docs | Policy, reports, environments | V0.3.38 |

```text
Update V0.3.39

- Validated the first complete secure team workflow
```

**Scope**

- Add an end-to-end scenario covering sign-in, project isolation, two revisions, policy enforcement, environment selection, backup and restore; publish the C milestone evidence.

**Acceptance**

- A fresh operator completes the scenario from documentation; all C P0 acceptance cases pass before workflow features are enabled for pilots.

---

## 8. Track D: Findings to reviewed remediation

**Outcome:** Developers and reviewers can assign, fix, verify and close findings with defensible exceptions and readable evidence.

### Milestone D1: Actionable findings and ownership

**Priority:** P1. **Readiness gaps:** R08, R18.

#### V0.4.0: Persistent finding occurrences

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.0` | Feature | Finding model, project workflow, UI | V0.3.39 |

```text
Update V0.4.0

- Added durable records for individual finding occurrences
```

**Scope**

- Keep Finding.id and existing SARIF fingerprints unchanged; add versioned workflow IDs linked to logical collection, revision and occurrence with an explicit alias migration.

**Acceptance**

- New, recurring and resolved occurrences reconcile across scans without rewriting old public IDs or exposing credential values.

---

#### V0.4.1: Finding lifecycle

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.1` | Feature | Finding model, project workflow, UI | V0.4.0 |

```text
Update V0.4.1

- Added open, in-progress, accepted-risk and verified-resolved states
```

**Scope**

- Define allowed transitions and keep scanner presence separate from human status; only a qualifying subsequent scan verifies resolution.

**Acceptance**

- Marking an issue done does not remove it from security counts; reappearance reopens the same tracked occurrence when identity is unambiguous.

---

#### V0.4.2: Owners and due dates

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.2` | Feature | Finding model, project workflow, UI | V0.4.1 |

```text
Update V0.4.2

- Added accountable owners and due dates for findings
```

**Scope**

- Assign individual or team owners within project membership; validate inactive owners and preserve reassignment history.

**Acceptance**

- An owner can find their work and due dates; removed members leave an explicit unassigned state rather than inaccessible work.

---

#### V0.4.3: Service ownership rules

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.3` | Feature | Finding model, project workflow, UI | V0.4.2 |

```text
Update V0.4.3

- Mapped collections and request folders to responsible teams
```

**Scope**

- Add ordered, previewable ownership patterns over nonsecret source paths and service metadata; explain unmatched and ambiguous matches.

**Acceptance**

- A mapping preview shows exactly which findings change owner; precedence is deterministic and a broad rule cannot silently override a specific rule.

---

#### V0.4.4: Triage inbox and saved views

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.4` | Feature | Finding model, project workflow, UI | V0.4.3 |

```text
Update V0.4.4

- Added a shared inbox for new, unowned and overdue findings
```

**Scope**

- Create filters and saved views over project, owner, state, severity and rule; retain existing query deep links and enforce scope on the server.

**Acceptance**

- A reviewer opens a saved view after a fresh login and sees the same authorized query; empty and stale views offer recovery.

---

#### V0.4.5: Safe bulk triage

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.5` | Feature | Finding model, project workflow, UI | V0.4.4 |

```text
Update V0.4.5

- Added previewable bulk assignment and status changes
```

**Scope**

- Show affected count and selection scope, recheck permissions and revisions per record, and return partial-failure details instead of pretending atomic success.

**Acceptance**

- A selection spanning changed or revoked records updates only allowed items and provides a retryable list of failures without losing selection context.

---

#### V0.4.6: Remediation notes and external references

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.6` | Feature | Finding model, project workflow, UI | V0.4.5 |

```text
Update V0.4.6

- Added sanitized notes and links to existing issue trackers
```

**Scope**

- Store short text notes, rationale and validated HTTPS references; reject active content and redact credential-shaped pasted text before saving.

**Acceptance**

- A note with HTML or a synthetic token cannot execute or leak in reports; valid tracker links remain usable and changes are attributed.

---

#### V0.4.7: Finding activity timeline

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.7` | Feature | Finding model, project workflow, UI | V0.4.6 |

```text
Update V0.4.7

- Added an attributable history of finding decisions
```

**Scope**

- Show scans, ownership changes, comments, state changes and repair references with actor and timestamps; separate human decisions from automated observations.

**Acceptance**

- A reviewer can reconstruct how a finding reached its current state; unauthorized projects and raw secret evidence never enter the timeline.

---

### Milestone D2: Review and exception governance

**Priority:** P0. **Readiness gaps:** R09, R04.

#### V0.4.8: Exception request workflow

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.8` | Feature | Review state, policy approvals, audit | V0.4.7 |

```text
Update V0.4.8

- Added requests for scoped, expiring risk exceptions
```

**Scope**

- Build on existing reasoned suppressions with occurrence scope, owner, justification, expiry and attachment references; keep requested exceptions active in gates until approval.

**Acceptance**

- An exception request alone suppresses nothing; missing rationale, broad unintended scope and invalid expiry are refused.

---

#### V0.4.9: Independent exception approval

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.9` | Security, Feature | Review state, policy approvals, audit | V0.4.8 |

```text
Update V0.4.9

- Required authorized review for risk acceptance
```

**Scope**

- Enforce reviewer role and configurable separation of requester and approver; handle revoked reviewers and preserve the prior scanner result.

**Acceptance**

- A requester cannot approve their own exception where separation is required; forged client state cannot grant an accepted-risk status.

---

#### V0.4.10: Exception expiry and revalidation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.10` | Enhancement | Review state, policy approvals, audit | V0.4.9 |

```text
Update V0.4.10

- Reopened findings when their exception expired
```

**Scope**

- Evaluate expiry in browser, CLI and team workflows using an explicit clock; notify owners through the in-app inbox and require re-review after relevant scope changes.

**Acceptance**

- At expiry the next gate fails for the active finding; different client time zones cannot extend acceptance.

---

#### V0.4.11: Baseline change review

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.11` | Security, Feature | Review state, policy approvals, audit | V0.4.10 |

```text
Update V0.4.11

- Added a reviewable baseline change summary
```

**Scope**

- Show newly accepted, removed and reappearing occurrences and require reviewer approval for governed baseline updates; retain CLI files for Git review.

**Acceptance**

- A blanket baseline regeneration is visible as a policy decision and cannot replace the approved baseline without required review.

---

#### V0.4.12: Policy change approvals

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.12` | Security, Feature | Review state, policy approvals, audit | V0.4.11 |

```text
Update V0.4.12

- Added policy drafts with impact review and approval
```

**Scope**

- Keep draft and active policy revisions separate; attach affected rules, sample scan delta and approver to activation; support rollback to a known policy.

**Acceptance**

- A draft severity downgrade does not alter gates; publication records a reviewer and a reproducible policy digest.

---

#### V0.4.13: Coverage and suppression transparency

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.13` | Enhancement | Review state, policy approvals, audit | V0.4.12 |

```text
Update V0.4.13

- Showed disabled, skipped, suppressed and unresolved checks beside results
```

**Scope**

- Add coverage summaries to UI and reports so zero findings is distinguishable from no applicable checks or excluded input.

**Acceptance**

- A run with every optional pack off or all findings suppressed cannot be presented as a fully checked clean collection.

---

#### V0.4.14: Review decision snapshots

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.14` | Feature | Review state, policy approvals, audit | V0.4.13 |

```text
Update V0.4.14

- Bound approvals to an exact input and policy revision
```

**Scope**

- Create immutable review records naming collection revision, scan digest, environment manifest and policy; invalidate approval when relevant input changes.

**Acceptance**

- Changing a collection or policy after approval displays stale approval and cannot reuse the old decision to pass a release gate.

---

#### V0.4.15: Remediation governance acceptance

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.15` | Chore | Review state, policy approvals, audit | V0.4.14 |

```text
Update V0.4.15

- Validated exception and approval boundaries end to end
```

**Scope**

- Exercise requester, reviewer and administrator journeys with expiry, revoked membership, baseline rebasing and scan recurrence; provide machine-readable decision evidence.

**Acceptance**

- Tests demonstrate that human closure, browser overrides and stale approvals cannot conceal an active unaccepted critical occurrence.

---

### Milestone D3: Repair correctness and handoff

**Priority:** P0. **Readiness gaps:** R10, R19.

#### V0.4.16: Occurrence-level repair selection

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.16` | Bug, Enhancement | Repair engine, diff UI, CLI | V0.4.15 |

```text
Update V0.4.16

- Made repair selection and score estimates match affected occurrences
```

**Scope**

- Replace whole-rule removal in RepairPage estimates with occurrence-level simulation; pass actual score weights and report remaining findings.

**Acceptance**

- Selecting one fix from a multi-occurrence rule leaves the others visible; estimated and post-repair results agree or explain any remaining uncertainty.

---

#### V0.4.17: Repair preview worker

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.17` | Enhancement | Repair engine, diff UI, CLI | V0.4.16 |

```text
Update V0.4.17

- Moved expensive repair preview and validation off the UI thread
```

**Scope**

- Run parsing, plan generation and safe preview generation in a bounded worker with cancellation and versioned job inputs.

**Acceptance**

- Previewing a large collection keeps keyboard navigation responsive; cancelled or stale previews cannot overwrite a newer plan.

---

#### V0.4.18: Structured masked repair diff

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.18` | Feature | Repair engine, diff UI, CLI | V0.4.17 |

```text
Update V0.4.18

- Added a field-level before-and-after repair diff
```

**Scope**

- Display JSON pointer, operation, risk and masked old and new values; include variables, auth inheritance and affected environments where relevant.

**Acceptance**

- Reviewers can inspect every changed field; secret sentinels never appear in the diff, clipboard or downloadable preview report.

---

#### V0.4.19: Repair conflicts and prerequisites

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.19` | Enhancement | Repair engine, diff UI, CLI | V0.4.18 |

```text
Update V0.4.19

- Explained conflicting fixes and required ordering
```

**Scope**

- Detect overlapping JSON edits, variable-name collisions and mutually exclusive auth changes; offer a coherent plan rather than silently skipping conflicting operations.

**Acceptance**

- Conflicting edits cannot apply together without explicit resolution; unrelated safe repairs remain selectable and deterministic.

---

#### V0.4.20: Repair round-trip guarantees

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.20` | Bug, Chore | Repair engine, diff UI, CLI | V0.4.19 |

```text
Update V0.4.20

- Protected unsupported collection fields during repair
```

**Scope**

- Preserve unknown extensions, disabled fields, examples and body formatting where practical; add structural invariants and format-specific repair support declarations.

**Acceptance**

- Repair changes only intended paths in golden fixtures; unsupported fields survive byte-equivalent where untouched or structurally equivalent where serialization is required.

---

#### V0.4.21: Post-repair safety verification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.21` | Security, Enhancement | Repair engine, diff UI, CLI | V0.4.20 |

```text
Update V0.4.21

- Rechecked repaired output for residual secrets and structural validity
```

**Scope**

- Rescan with the same effective policy and independent redaction assertions; distinguish fixed, remaining, introduced and unverified findings before export.

**Acceptance**

- A deliberately faulty repair cannot be labelled successful; remaining sensitive locations are shown without revealing the secret.

---

#### V0.4.22: Repair patch and CLI dry run

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.22` | Feature | Repair engine, diff UI, CLI | V0.4.21 |

```text
Update V0.4.22

- Added reviewable repair plans for repository workflows
```

**Scope**

- Export a nonsecret plan plus a separately requested repaired artifact; add CLI dry-run and apply with input digest preconditions and overwrite protection.

**Acceptance**

- Applying a plan to a changed file fails safely; a dry run writes no source file and reports the exact intended changes.

---

#### V0.4.23: Undo and immutable repaired revisions

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.23` | Enhancement | Repair engine, diff UI, CLI | V0.4.22 |

```text
Update V0.4.23

- Saved repairs as new revisions with a reversible history
```

**Scope**

- Keep original input immutable; support undo before save, restored selection on failure and new-revision save with author and repair-plan reference.

**Acceptance**

- A failed save does not lose the original or preview; reverting a repair never mutates an approved historical revision.

---

### Milestone D4: Detection confidence and coverage

**Priority:** P1. **Readiness gaps:** R14, R24.

#### V0.4.24: Rule explanations and confidence

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.24` | Enhancement | Audit engine, rule packs, quality corpus | V0.4.23 |

```text
Update V0.4.24

- Explained why each rule fired and how certain the result is
```

**Scope**

- Add applicability, evidence basis, static-analysis limit and remediation guidance metadata; distinguish observed literals from inferred missing workflow steps.

**Acceptance**

- Every enabled rule has an explanation; missing an export request is never phrased as proof the production service lacks a security control.

---

#### V0.4.25: Labeled detection quality corpus

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.25` | Chore | Audit engine, rule packs, quality corpus | V0.4.24 |

```text
Update V0.4.25

- Added reviewed positive and negative examples for detector quality
```

**Scope**

- Build a licensed synthetic or consented corpus by input location and IAM platform; record expected occurrences and false-positive rationale separately from implementation fixtures.

**Acceptance**

- CI reports precision and recall on this corpus by rule family; corpus results are explicitly not claimed as population-wide detection rates.

---

#### V0.4.26: Unknown and partial analysis states

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.26` | Enhancement | Audit engine, rule packs, quality corpus | V0.4.25 |

```text
Update V0.4.26

- Reported unsupported or truncated analysis explicitly
```

**Scope**

- Propagate parser warnings, unresolved dynamic variables and unsupported protocol or script constructs into coverage and policy results.

**Acceptance**

- Unsupported input cannot silently receive a complete-analysis badge; strict CI can fail on incomplete required coverage with a distinct reason.

---

#### V0.4.27: Script analysis accuracy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.27` | Enhancement | Audit engine, rule packs, quality corpus | V0.4.26 |

```text
Update V0.4.27

- Improved static script inspection without executing scripts
```

**Scope**

- Introduce bounded parsing for supported JavaScript constructs and safe constant propagation, retaining provider-pattern fallback; document unsupported dynamic expressions.

**Acceptance**

- Fixtures cover aliases, concatenation and dynamic false positives; malicious scripts are never executed and parser budgets are enforced.

---

#### V0.4.28: Rule-specific tuning controls

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.28` | Feature | Audit engine, rule packs, quality corpus | V0.4.27 |

```text
Update V0.4.28

- Added bounded allowlists and applicability settings
```

**Scope**

- Support reviewed host, path and placeholder allowlists and rule parameters through the shared policy schema; include scope and expiry where relevant.

**Acceptance**

- A narrow allowlist suppresses only intended occurrences; invalid patterns fail validation and cannot create unbounded regex work.

---

#### V0.4.29: IAM context overrides

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.29` | Enhancement | Audit engine, rule packs, quality corpus | V0.4.28 |

```text
Update V0.4.29

- Allowed teams to correct inferred platform and lifecycle context
```

**Scope**

- Let an authorized policy author declare known platform, environment or workflow grouping with visible provenance while retaining automatic signals.

**Acceptance**

- A legitimate split lifecycle is not falsely reported as a complete missing-control claim; overriding context never suppresses literal-secret checks.

---

#### V0.4.30: General API collection quality pack

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.30` | Feature | Audit engine, rule packs, quality corpus | V0.4.29 |

```text
Update V0.4.30

- Added optional checks for operationally useful API examples
```

**Scope**

- Check declared descriptions, error examples, pagination examples, idempotency examples and version metadata as collection quality signals, with applicability settings.

**Acceptance**

- Positive and negative fixtures distinguish optional conventions from security failures; absent examples never claim absent runtime capabilities.

---

#### V0.4.31: Rule maintenance and regression policy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.31` | Docs, Chore | Audit engine, rule packs, quality corpus | V0.4.30 |

```text
Update V0.4.31

- Defined rule ownership and evidence-based rule updates
```

**Scope**

- Assign maintainers, source references, review dates, fixture requirements and change notes to each pack; warn on incompatible detection changes before baseline adoption.

**Acceptance**

- A new rule or changed severity cannot merge without metadata and quality evidence; existing rule IDs and titles remain stable.

---

### Milestone D5: Review experience and evidence

**Priority:** P1. **Readiness gaps:** R17, R18, R19.

#### V0.4.32: Guided first finding workflow

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.32` | Enhancement | Reports, accessible navigation, comparison | V0.4.31 |

```text
Update V0.4.32

- Guided first-time users from import to a reviewed fix
```

**Scope**

- Add a dismissible walkthrough using the existing samples with privacy explanation, finding evidence, manual action and repaired-copy download.

**Acceptance**

- A new user completes the defined sample task without reading source code; sample data and real imports remain clearly distinguishable.

---

#### V0.4.33: Accessible triage and repair journeys

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.33` | Enhancement | Reports, accessible navigation, comparison | V0.4.32 |

```text
Update V0.4.33

- Made review and repair usable with keyboard and screen readers
```

**Scope**

- Audit newly added dialogs, tables, focus return, status announcements and destructive-action confirmations; include IdentityPage in shared page coverage.

**Acceptance**

- Keyboard-only and screen-reader checks complete assign, exception and repair journeys; axe has no serious or critical violations on those states.

---

#### V0.4.34: Readable dense evidence

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.34` | Enhancement | Reports, accessible navigation, comparison | V0.4.33 |

```text
Update V0.4.34

- Improved long-body and large-evidence review
```

**Scope**

- Add bounded evidence expansion, stable anchors, wrapping controls and request context without rendering every occurrence at once.

**Acceptance**

- A finding with thousands of occurrences opens within the evidence budget, preserves focus and makes hidden or truncated content explicit.

---

#### V0.4.35: Persistent authorized review links

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.35` | Feature | Reports, accessible navigation, comparison | V0.4.34 |

```text
Update V0.4.35

- Opened exact collection revisions and findings from shared links
```

**Scope**

- Use opaque project and revision identifiers, authorization checks and useful missing-access recovery; avoid embedding request names or evidence in new URLs.

**Acceptance**

- A teammate with access reaches the exact reviewed revision after login; unauthorized recipients see no title, count or metadata leakage.

---

#### V0.4.36: Comparison ambiguity and policy awareness

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.36` | Enhancement | Reports, accessible navigation, comparison | V0.4.35 |

```text
Update V0.4.36

- Explained uncertain request matches and incomparable scans
```

**Scope**

- Extend compare.ts to mark ambiguous duplicate-URL matches and differing policies or environment manifests; provide a mapping review step where necessary.

**Acceptance**

- Reordered duplicate requests cannot silently inherit another request's approval; policy changes are reported separately from input changes.

---

#### V0.4.37: Team review report

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.37` | Feature | Reports, accessible navigation, comparison | V0.4.36 |

```text
Update V0.4.37

- Added a concise report of risks, decisions and next actions
```

**Scope**

- Build an export containing current unresolved occurrences, owners, due dates, accepted risks and approval validity with coverage and provenance; retain external privacy profiles.

**Acceptance**

- A reviewer can trace every summary count to an occurrence or decision and identify stale scans without access to raw secrets.

---

#### V0.4.38: Secret rotation handoff

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.38` | Feature, Docs | Reports, accessible navigation, comparison | V0.4.37 |

```text
Update V0.4.38

- Added practical follow-up steps for exposed credentials
```

**Scope**

- Explain that redaction does not revoke credentials; provide provider-linked rotation guidance and optional owner acknowledgement without fetching or testing the token.

**Acceptance**

- Sanitizing a collection does not automatically mark a leak remediated; a separate verification record documents rotation evidence without storing secrets.

---

#### V0.4.39: Team workflow pilot checkpoint

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.4.39` | Chore, Docs | Reports, accessible navigation, comparison | V0.4.38 |

```text
Update V0.4.39

- Validated the complete review workflow with pilot tasks
```

**Scope**

- Run import, assign, exception, repair, rescan and shared-review tasks with a small team; record task success and friction with consent and no raw collection capture.

**Acceptance**

- At least four of five representative participants complete core tasks without assistance; every failure becomes a scoped issue before the D milestone closes.

---

## 9. Track E: Integration into existing team tools

**Outcome:** Teams can run policy in Git workflows, inspect collection-to-contract drift and send redacted results to the tools they already use.

### Milestone E1: Trusted CI results and fast adoption

**Priority:** P0. **Readiness gaps:** R12, R05, R19.

#### V0.5.0: Scoped CI service accounts

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.0` | Security, Feature | CLI, service accounts, CI, report API | V0.4.39 |

```text
Update V0.5.0

- Added project-scoped automation credentials
```

**Scope**

- Create expiring service tokens with hashed storage, narrow ingest permissions, rotation, revocation and last-use visibility; keep tokens out of browser storage and logs.

**Acceptance**

- A token can submit only to its assigned project, cannot read raw collections and stops working immediately after revocation.

---

#### V0.5.1: Validated scan ingestion schema

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.1` | Security, Feature | CLI, service accounts, CI, report API | V0.5.0 |

```text
Update V0.5.1

- Added a strict schema for externally produced scan results
```

**Scope**

- Validate report size, enums, provenance, identifiers, HTML-safe text and project scope; reject raw credential fields and unsupported schema versions.

**Acceptance**

- Malformed or oversize uploads fail before persistence; schema-confusion and cross-project references cannot create trusted findings.

---

#### V0.5.2: Authenticated CI result ingestion

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.2` | Feature | CLI, service accounts, CI, report API | V0.5.1 |

```text
Update V0.5.2

- Stored idempotent CI scan summaries without uploading collections
```

**Scope**

- Add a scoped report-ingest endpoint with idempotency keys and explicit source trust; store redacted results and provenance only by default.

**Acceptance**

- Retrying a CI run creates one scan; forged browser reports are labelled unverified and cannot satisfy trusted approval requirements.

---

#### V0.5.3: Trusted gate provenance

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.3` | Security, Enhancement | CLI, service accounts, CI, report API | V0.5.2 |

```text
Update V0.5.3

- Verified the source of CI approval evidence
```

**Scope**

- Bind trusted results to configured repository, commit, workflow and policy using verified workload identity or controlled signing keys; document assurance limits for ordinary tokens.

**Acceptance**

- A submission naming another repository or stale commit cannot masquerade as a trusted gate, even with a valid basic ingest token.

---

#### V0.5.4: Single-pass CLI report generation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.4` | Enhancement | CLI, service accounts, CI, report API | V0.5.3 |

```text
Update V0.5.4

- Generated multiple report formats from one analysis
```

**Scope**

- Extend cli/postscope.ts to emit JSON, SARIF, Markdown and JUnit from a shared result; update the composite action to avoid its current second scan.

**Acceptance**

- All requested formats describe the same input and policy digest; the scan executes once and preserves policy and usage exit codes.

---

#### V0.5.5: Changed-file and monorepo scanning

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.5` | Feature | CLI, service accounts, CI, report API | V0.5.4 |

```text
Update V0.5.5

- Added bounded changed-file scans and repository input manifests
```

**Scope**

- Support explicit Git revision ranges, include and exclude rules and per-project configs without executing Git hooks; account for shared environment or policy changes.

**Acceptance**

- A changed shared policy rescans affected collections; deleted files and no-match cases are explicit, and unchanged inputs are skipped deterministically.

---

#### V0.5.6: Fork-safe pull request reporting

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.6` | Security, Enhancement | CLI, service accounts, CI, report API | V0.5.5 |

```text
Update V0.5.6

- Added safe pull request summaries without privileged scan execution
```

**Scope**

- Run untrusted collection scans without write credentials; publish redacted artifacts and optional summaries in a separate trusted step that never executes PR code.

**Acceptance**

- A fork PR cannot obtain write tokens through scripts or config; HTML/JUnit artifacts remain available when SARIF upload is unavailable.

---

#### V0.5.7: Reusable CI integration fixtures

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.7` | Chore, Docs | CLI, service accounts, CI, report API | V0.5.6 |

```text
Update V0.5.7

- Validated GitHub, GitLab and Azure pipeline templates
```

**Scope**

- Ship minimal tested templates using release artifacts, accurate exit-code handling, always-upload reports and platform permission guidance; keep plain CLI usage universal.

**Acceptance**

- Each template fails on a new critical fixture, succeeds with an approved exception and retains reports after policy failure.

---

### Milestone E2: OpenAPI contract context

**Priority:** P1. **Readiness gaps:** R11, R24.

#### V0.5.8: Format adapter contract

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.8` | Feature, Chore | Input adapters, source maps, comparison | V0.5.7 |

```text
Update V0.5.8

- Separated source formats from normalized audit inputs
```

**Scope**

- Define capabilities, source pointers, parse warnings and repair support for adapters while keeping the current Postman parser API compatible.

**Acceptance**

- Postman adapter output matches existing fixtures; unsupported capabilities are visible and cannot be mistaken for complete analysis.

---

#### V0.5.9: Offline OpenAPI JSON and YAML input

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.9` | Feature | Input adapters, source maps, comparison | V0.5.8 |

```text
Update V0.5.9

- Added bounded OpenAPI 3.0 and 3.1 document imports
```

**Scope**

- Parse local files with safe YAML settings, document size limits and version validation; reject executable tags and network reference fetching.

**Acceptance**

- Equivalent JSON and YAML fixtures yield the same normalized operations; alias bombs and unsupported versions fail with clear diagnostics.

---

#### V0.5.10: Local reference resolution

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.10` | Security, Feature | Input adapters, source maps, comparison | V0.5.9 |

```text
Update V0.5.10

- Resolved OpenAPI references within explicit input boundaries
```

**Scope**

- Resolve bundled or explicitly provided relative references with cycle, depth and byte limits; reject network URLs and paths outside the approved input root.

**Acceptance**

- Traversal, symlink escape, cyclic references and missing files cannot trigger network access or silent omission.

---

#### V0.5.11: Operation and collection matching

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.11` | Feature | Input adapters, source maps, comparison | V0.5.10 |

```text
Update V0.5.11

- Mapped collection requests to OpenAPI operations
```

**Scope**

- Match method and normalized paths with explicit base URL bindings; expose ambiguity, unbound variables and unmatched requests rather than guessing.

**Acceptance**

- Parameterized paths match correctly; two plausible operations require clarification and never produce a false exact match.

---

#### V0.5.12: Declared authentication drift

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.12` | Feature | Input adapters, source maps, comparison | V0.5.11 |

```text
Update V0.5.12

- Highlighted differences between collection auth and contract declarations
```

**Scope**

- Compare operation-level and inherited OpenAPI security requirements against observed collection auth configuration; state that runtime authorization remains untested.

**Acceptance**

- Fixtures cover optional auth, alternatives and multiple schemes; reported drift distinguishes declared contract mismatch from an exploitable vulnerability.

---

#### V0.5.13: Request and example contract checks

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.13` | Feature | Input adapters, source maps, comparison | V0.5.12 |

```text
Update V0.5.13

- Checked saved request and response examples against local schemas
```

**Scope**

- Validate supported parameters, content types and example bodies with source locations and bounded schema evaluation; disclose unsupported keywords.

**Acceptance**

- Known-invalid examples are found without sending requests; valid nullable and composed-schema examples avoid documented false positives.

---

#### V0.5.14: Contract and collection change review

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.14` | Feature | Input adapters, source maps, comparison | V0.5.13 |

```text
Update V0.5.14

- Compared contract revisions alongside collection revisions
```

**Scope**

- Show added, removed and potentially breaking declared operations plus collection coverage; keep design-time compatibility separate from runtime behavior.

**Acceptance**

- A removed required operation appears with affected collection requests; policy and format differences cannot be hidden as API changes.

---

#### V0.5.15: Contract evidence and Spectral handoff

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.15` | Enhancement, Docs | Input adapters, source maps, comparison | V0.5.14 |

```text
Update V0.5.15

- Added source-linked contract reports and a Spectral companion recipe
```

**Scope**

- Export original source pointers and coverage for contract checks; document using Spectral for full specification style governance rather than duplicating its rule engine.

**Acceptance**

- A reviewer opens the exact YAML or JSON location from a report; companion outputs retain distinct tool and rule provenance.

---

### Milestone E3: Collection ecosystem adapters

**Priority:** P1. **Readiness gaps:** R11, R22.

#### V0.5.16: Bruno static import adapter

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.16` | Feature | Bruno adapter, Postman retrieval, input UX | V0.5.15 |

```text
Update V0.5.16

- Added local Bruno collection inspection
```

**Scope**

- Parse a pinned, documented subset of Bruno text and metadata into the adapter contract; never execute scripts or resolve secret-provider values.

**Acceptance**

- Supported .bru fixtures retain auth, variables and source paths; unsupported syntax generates an explicit partial-analysis warning.

---

#### V0.5.17: Bruno folder and environment semantics

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.17` | Enhancement | Bruno adapter, Postman retrieval, input UX | V0.5.16 |

```text
Update V0.5.17

- Preserved Bruno folder and environment precedence
```

**Scope**

- Support documented inheritance and selected environment bindings with nonsecret manifests; isolate each collection's variables.

**Acceptance**

- Nested folder and environment fixtures resolve consistently with the declared supported Bruno version; unresolved runtime secrets remain unknown.

---

#### V0.5.18: Bruno evidence and repair boundaries

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.18` | Enhancement | Bruno adapter, Postman retrieval, input UX | V0.5.17 |

```text
Update V0.5.18

- Linked Bruno findings to source lines and limited safe fixes
```

**Scope**

- Provide source mappings and masked evidence; enable only proven text-preserving repairs and mark other fixes as manual guidance.

**Acceptance**

- Every exported source location points to the expected file and line; unsupported repairs cannot rewrite Bruno files accidentally.

---

#### V0.5.19: Adapter compatibility corpus

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.19` | Chore, Docs | Bruno adapter, Postman retrieval, input UX | V0.5.18 |

```text
Update V0.5.19

- Published input-format coverage and round-trip guarantees
```

**Scope**

- Maintain cross-format fixtures, supported-version tables and behavior comparisons; include format detection and graceful unsupported-file UX.

**Acceptance**

- Equivalent Postman and Bruno fixtures agree on shared secret checks; format-specific gaps are listed rather than scored as passed.

---

#### V0.5.20: Opt-in Postman source retrieval

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.20` | Feature | Bruno adapter, Postman retrieval, input UX | V0.5.19 |

```text
Update V0.5.20

- Added a CLI-only Postman collection fetch step
```

**Scope**

- Fetch an explicitly selected collection from the official API using operator-provided credentials; keep network retrieval separate from offline analysis and disabled by default.

**Acceptance**

- Offline commands make no outbound calls; fetch requires a deliberate command and never stores its API token in the collection or report.

---

#### V0.5.21: Retrieval network and credential safety

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.21` | Security | Bruno adapter, Postman retrieval, input UX | V0.5.20 |

```text
Update V0.5.21

- Bounded remote collection retrieval and credential exposure
```

**Scope**

- Restrict retrieval to approved service endpoints, validate redirects, enforce timeout and response caps, and read credentials through a protected file or secret environment variable.

**Acceptance**

- Redirects to loopback, private metadata endpoints or unapproved hosts are refused; errors and debug output contain no token.

---

#### V0.5.22: Source freshness and change metadata

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.22` | Enhancement | Bruno adapter, Postman retrieval, input UX | V0.5.21 |

```text
Update V0.5.22

- Recorded when and where remotely retrieved collections originated
```

**Scope**

- Capture source ID, fetched revision or digest, timestamp and freshness status; distinguish downloaded input from locally modified copies.

**Acceptance**

- A stale or changed source is visible in review; retries do not create misleading new revisions when content is unchanged.

---

#### V0.5.23: Repeatable source-to-CI recipe

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.23` | Docs, Chore | Bruno adapter, Postman retrieval, input UX | V0.5.22 |

```text
Update V0.5.23

- Added a tested retrieve, scan and publish-results workflow
```

**Scope**

- Provide a scheduled-run recipe owned by the team's existing CI, with explicit credential scope, no raw artifact upload by default and actionable failure reporting.

**Acceptance**

- The recipe handles rate limits and unavailable sources without passing the gate or publishing partial input as a successful scan.

---

### Milestone E4: Issue and notification handoffs

**Priority:** P1. **Readiness gaps:** R13, R08.

#### V0.5.24: Versioned integration event contract

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.24` | Feature | Integration settings, delivery queue, connectors | V0.5.23 |

```text
Update V0.5.24

- Added redacted events for finding and review changes
```

**Scope**

- Define event IDs, project scope, actor, occurrence reference and schema version; prohibit raw bodies, tokens and full evidence in outbound payloads.

**Acceptance**

- Contract tests reject secret sentinels and unsupported payload versions; duplicate delivery preserves the same event ID.

---

#### V0.5.25: Durable delivery outbox

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.25` | Feature | Integration settings, delivery queue, connectors | V0.5.24 |

```text
Update V0.5.25

- Queued integration events transactionally with bounded retries
```

**Scope**

- Persist an outbox with the state change, use exponential backoff and idempotency keys, cap retries and expose dead-letter states.

**Acceptance**

- A crash between state update and delivery neither loses the event nor creates duplicate external work; permanent errors remain inspectable.

---

#### V0.5.26: Signed webhook delivery

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.26` | Security, Feature | Integration settings, delivery queue, connectors | V0.5.25 |

```text
Update V0.5.26

- Added authenticated and restricted webhook destinations
```

**Scope**

- Use HTTPS, HMAC signatures with timestamps, scoped secret storage, destination allowlists and SSRF-resistant resolution and redirect policy.

**Acceptance**

- Private-address and rebinding cases are blocked unless an explicit internal-integration policy allows them; replay and wrong signatures fail receiver fixtures.

---

#### V0.5.27: Integration administration and diagnostics

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.27` | Feature | Integration settings, delivery queue, connectors | V0.5.26 |

```text
Update V0.5.27

- Added connection tests, rotation and delivery status
```

**Scope**

- Let project admins configure destinations, rotate secrets, test with synthetic payloads, pause delivery and inspect redacted failures.

**Acceptance**

- A connection test sends only synthetic content; expired credentials are actionable and a non-admin cannot reveal or change secrets.

---

#### V0.5.28: GitHub issue handoff

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.28` | Feature | Integration settings, delivery queue, connectors | V0.5.27 |

```text
Update V0.5.28

- Created and reconciled selected findings as GitHub issues
```

**Scope**

- Offer an explicit publish preview and repository allowlist using least-privilege credentials; deduplicate by project occurrence and keep sensitive evidence out of issue bodies.

**Acceptance**

- Repeated publication updates one issue; denied permissions or closed issues do not erase the local finding or change its scanner state.

---

#### V0.5.29: GitLab issue handoff

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.29` | Feature | Integration settings, delivery queue, connectors | V0.5.28 |

```text
Update V0.5.29

- Created and reconciled selected findings as GitLab issues
```

**Scope**

- Reuse the connector contract and redacted template with GitLab-specific scope, idempotency and self-managed host configuration.

**Acceptance**

- A simulated rate-limit or network retry produces no duplicate issue; self-managed destinations obey the outbound network policy.

---

#### V0.5.30: Notification filtering and digests

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.30` | Feature | Integration settings, delivery queue, connectors | V0.5.29 |

```text
Update V0.5.30

- Added actionable in-app and webhook notification preferences
```

**Scope**

- Support owner mentions, new critical findings, expiring exceptions and failures with deduplication, quiet periods and project-scoped digests; document Slack and Teams webhook receivers.

**Acceptance**

- Unchanged scans emit no repeated alerts; a revoked member receives no later project payload; preferences do not suppress audit evidence.

---

#### V0.5.31: Connector acceptance and outage drill

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.31` | Chore, Docs | Integration settings, delivery queue, connectors | V0.5.30 |

```text
Update V0.5.31

- Validated integration failures and secret handling
```

**Scope**

- Exercise expired credentials, 429, 5xx, redirects, unavailable receivers, deletion and replays against controlled fixtures; publish recovery instructions.

**Acceptance**

- An operator can replay a failed delivery safely, rotate credentials and prove no raw collection or credential was sent.

---

### Milestone E5: Team conventions and developer ergonomics

**Priority:** P1. **Readiness gaps:** R14, R12, R20.

#### V0.5.32: Declarative custom rule schema

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.32` | Feature | Declarative rules, editor workflow, documentation | V0.5.31 |

```text
Update V0.5.32

- Added bounded team rules for collection conventions
```

**Scope**

- Support a small declarative rule vocabulary for field presence, approved values and safe patterns; prohibit arbitrary JavaScript and network access.

**Acceptance**

- Invalid selectors, unsafe expressions and unknown rule actions are rejected; a custom rule cannot read files, execute code or make requests.

---

#### V0.5.33: Custom rule preview and fixtures

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.33` | Feature | Declarative rules, editor workflow, documentation | V0.5.32 |

```text
Update V0.5.33

- Added a local rule workbench with positive and negative examples
```

**Scope**

- Let policy authors preview a declarative rule on synthetic or current input with bounded execution, clear match paths and per-rule disable controls.

**Acceptance**

- A pathological custom pattern cannot hang the app; the workbench shows false-positive examples and never silently publishes a draft rule.

---

#### V0.5.34: Versioned rule pack distribution

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.34` | Feature | Declarative rules, editor workflow, documentation | V0.5.33 |

```text
Update V0.5.34

- Loaded approved rule packs from pinned local artifacts
```

**Scope**

- Package declarative rules, metadata, fixtures and compatibility constraints with digests; resolve local files or explicitly fetched approved artifacts, never arbitrary runtime downloads.

**Acceptance**

- Tampered or incompatible packs fail before analysis; offline scans use the exact pinned pack and record its digest.

---

#### V0.5.35: Organization policy overlays

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.35` | Enhancement | Declarative rules, editor workflow, documentation | V0.5.34 |

```text
Update V0.5.35

- Added transparent organization and project policy inheritance
```

**Scope**

- Extend C policy precedence with reusable overlays and mandatory minimums; show the effective source of each setting and prevent privilege expansion.

**Acceptance**

- A project overlay cannot weaken an organization minimum; export and CLI explanation show the identical resolved policy.

---

#### V0.5.36: Editor diagnostics workflow

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.36` | Feature | Declarative rules, editor workflow, documentation | V0.5.35 |

```text
Update V0.5.36

- Added an editor-friendly diagnostics command
```

**Scope**

- Emit stable file, line, rule, severity and remediation data with a documented problem-matcher recipe; use the CLI rather than requiring a separate privileged editor service.

**Acceptance**

- A sample editor task navigates to a finding in Postman, OpenAPI and Bruno files; paths with spaces and Unicode work on supported platforms.

---

#### V0.5.37: Pack author contribution guide

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.37` | Docs, Chore | Declarative rules, editor workflow, documentation | V0.5.36 |

```text
Update V0.5.37

- Added a contributor workflow for rules and adapters
```

**Scope**

- Document capability limits, synthetic fixture generation, licenses, performance budgets and compatibility checks; include a starter pack and adapter contract checklist.

**Acceptance**

- A contributor can add a sample custom rule and validate it without editing unrelated engine internals or using real credentials.

---

#### V0.5.38: Integration onboarding wizard

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.38` | Feature | Declarative rules, editor workflow, documentation | V0.5.37 |

```text
Update V0.5.38

- Generated safe CI and policy setup for a selected project
```

**Scope**

- Ask only for repository platform, paths and desired gate; preview generated files, required permissions and secret names without collecting secret values.

**Acceptance**

- Generated YAML and policy validate in fixtures; private GitHub repositories receive an HTML/JUnit fallback when code scanning is unavailable.

---

#### V0.5.39: Integration pilot checkpoint

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.5.39` | Chore, Docs | Declarative rules, editor workflow, documentation | V0.5.38 |

```text
Update V0.5.39

- Validated adoption in a startup and an existing platform team
```

**Scope**

- Run Postman-only and mixed-format repository pilots using CI, review links and one issue handoff; capture setup time and operational friction with consent.

**Acceptance**

- A fresh team reaches its first useful CI result within 30 minutes using docs; unresolved connector or format correctness failures block the milestone.

---

## 10. Track F: Performance, recovery and security assurance

**Outcome:** Operators can support the declared team workload, recover data, investigate failures and maintain a hardened deployment.

### Milestone F1: Measured interactive performance

**Priority:** P1. **Readiness gaps:** R15, R23.

#### V0.6.0: Performance profile and hotspot report

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.0` | Chore | Engine, browser rendering, CLI | V0.5.39 |

```text
Update V0.6.0

- Published a reproducible profile of the complete analysis workflow
```

**Scope**

- Profile the C corpus from file read through first usable result, evidence open, repair and export; separate cold and warm runs and worker transfer cost.

**Acceptance**

- A checked report identifies the dominant costs and fixed reference configuration; subsequent optimization targets measured hotspots rather than guessed complexity.

---

#### V0.6.1: Indexed request and finding lookups

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.1` | Enhancement | Engine, browser rendering, CLI | V0.6.0 |

```text
Update V0.6.1

- Reduced repeated full-list searches in review screens
```

**Scope**

- Build shared indexes for request IDs, rule occurrences, ownership and search tokens; replace measured repeated scans while preserving deterministic ordering.

**Acceptance**

- Indexed and reference implementations return identical results; large-collection navigation improves without unbounded index growth.

---

#### V0.6.2: Bounded evidence and identity rendering

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.2` | Enhancement | Engine, browser rendering, CLI | V0.6.1 |

```text
Update V0.6.2

- Kept large finding and IAM inventories responsive
```

**Scope**

- Paginate or virtualize measured heavy views including identity endpoints, repair items and library revisions; preserve accessible totals and focus.

**Acceptance**

- The high-occurrence corpus meets rendering budgets with bounded DOM rows; keyboard navigation reaches unloaded items correctly.

---

#### V0.6.3: Reduced raw-data duplication

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.3` | Enhancement | Engine, browser rendering, CLI | V0.6.2 |

```text
Update V0.6.3

- Lowered memory use during import, comparison and repair
```

**Scope**

- Avoid unnecessary JSON clones and raw-body copies; transfer compact indexed results and release obsolete buffers while preserving fields needed for correct diffs.

**Acceptance**

- Peak memory improves on the named large fixtures; no source field or comparison difference disappears because of compaction.

---

#### V0.6.4: Bounded batch CLI execution

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.4` | Enhancement | Engine, browser rendering, CLI | V0.6.3 |

```text
Update V0.6.4

- Added controllable concurrency and per-file resource limits
```

**Scope**

- Introduce a small worker pool for multi-file scans, cancellation and per-file outcomes; keep deterministic aggregate output and global resource caps.

**Acceptance**

- One pathological file times out without hanging the batch; output ordering and exit codes remain stable across worker counts.

---

#### V0.6.5: Large report generation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.5` | Enhancement | Engine, browser rendering, CLI | V0.6.4 |

```text
Update V0.6.5

- Generated large exports with bounded memory and explicit limits
```

**Scope**

- Stream CLI output where supported and move browser serialization to a worker; enforce SARIF size limits with explicit truncation metadata and full local alternatives.

**Acceptance**

- A large report completes within the memory target; truncation never hides that findings were omitted or turns a failed policy into a pass.

---

#### V0.6.6: Stable baseline and comparison scaling

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.6` | Enhancement | Engine, browser rendering, CLI | V0.6.5 |

```text
Update V0.6.6

- Reduced comparison cost for duplicate and reordered requests
```

**Scope**

- Optimize measured duplicate-key paths in compare.ts and occurrence reconciliation; preserve ambiguity flags and versioned identity migration.

**Acceptance**

- Adversarial repeated URLs do not cause quadratic growth within the supported envelope; known ambiguous matches stay unapproved.

---

#### V0.6.7: User-visible performance acceptance

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.7` | Chore | Engine, browser rendering, CLI | V0.6.6 |

```text
Update V0.6.7

- Enforced end-to-end latency and memory budgets in CI
```

**Scope**

- Add first-result, search, cancellation, repair-preview and export checks on fixed fixtures; keep historical trend artifacts and require evidence for budget increases.

**Acceptance**

- A seeded regression fails the relevant budget; all published claims include p50, p95, memory, fixture and environment details.

---

### Milestone F2: Data lifecycle and durability

**Priority:** P0. **Readiness gaps:** R07, R16, R03.

#### V0.6.8: Durable audit event writes

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.8` | Security, Enhancement | Metadata store, encryption, audit, retention | V0.6.7 |

```text
Update V0.6.8

- Made governed audit writes part of successful state changes
```

**Scope**

- Replace best-effort fire-and-forget mutation auditing with a transactional audit record or outbox; make the chosen failure mode explicit for sensitive reads and writes.

**Acceptance**

- Disk-full or audit-store failure cannot acknowledge an unaudited governed mutation; retries preserve one attributable event.

---

#### V0.6.9: Complete audit coverage

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.9` | Enhancement | Metadata store, encryption, audit, retention | V0.6.8 |

```text
Update V0.6.9

- Recorded access, exports, approvals, policy and membership changes
```

**Scope**

- Extend audit action types beyond save, open and delete; include denied sensitive operations and automated retention without storing payloads or credentials.

**Acceptance**

- Every permission-bearing workflow creates the expected minimal event; secret sentinels and raw request bodies are absent from audit files.

---

#### V0.6.10: Audit integrity and external export

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.10` | Security, Feature | Metadata store, encryption, audit, retention | V0.6.9 |

```text
Update V0.6.10

- Added verifiable audit export and tamper detection
```

**Scope**

- Sequence events, hash-chain export segments and support an external immutable sink; explicitly document that local chaining alone cannot stop a privileged operator rewriting history.

**Acceptance**

- Modified or missing exported segments fail verification; users can verify a retained external checkpoint without the live server.

---

#### V0.6.11: Encryption coverage and key rotation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.11` | Security, Enhancement | Metadata store, encryption, audit, retention | V0.6.10 |

```text
Update V0.6.11

- Extended encryption policy to new persisted team data
```

**Scope**

- Classify metadata, notes, scan reports and outbox payloads; encrypt sensitive records and backups where configured; rotate keys with resumable progress and separate key backup guidance.

**Acceptance**

- Old and new keys support a controlled rotation; wrong keys fail closed and an interrupted rotation preserves all readable records.

---

#### V0.6.12: Project retention policies

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.12` | Feature | Metadata store, encryption, audit, retention | V0.6.11 |

```text
Update V0.6.12

- Added previewable retention for scans, versions and delivery records
```

**Scope**

- Apply project-specific retention with dependency protection for approved evidence, quota previews and explicit audit retention; avoid silent cross-project eviction.

**Acceptance**

- A dry run lists exact deletions; protected review evidence survives and the execution records policy and counts without content.

---

#### V0.6.13: Deletion and data export lifecycle

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.13` | Security, Feature | Metadata store, encryption, audit, retention | V0.6.12 |

```text
Update V0.6.13

- Added controlled project export and deletion
```

**Scope**

- Provide authorized data export, staged deletion, legal-hold-style operator protection where configured and clear backup-expiry semantics; avoid promises of instant physical erasure.

**Acceptance**

- Deletion removes active references, search indexes and pending deliveries; an audit receipt explains any retained backups and their expiry.

---

#### V0.6.14: Crash recovery and corruption tools

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.14` | Enhancement | Metadata store, encryption, audit, retention | V0.6.13 |

```text
Update V0.6.14

- Added integrity checks and recoverable quarantine
```

**Scope**

- Verify metadata-to-payload references, quarantine corrupt records with visible counts and offer dry-run repair; refuse destructive repair without an explicit operator command.

**Acceptance**

- Injected torn writes and missing payloads are detected; unaffected projects remain readable and recovery never silently discards records.

---

#### V0.6.15: Restore and rotation failure drills

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.15` | Chore, Docs | Metadata store, encryption, audit, retention | V0.6.14 |

```text
Update V0.6.15

- Verified recovery under disk, key and interruption failures
```

**Scope**

- Automate backup, restore, rotation interruption and corrupted-record exercises for the supported store; record measured recovery time and data-loss boundaries.

**Acceptance**

- A clean-host restore meets the declared RPO and RTO on the reference dataset; unrecoverable cases produce documented operator actions.

---

### Milestone F3: Adversarial security validation

**Priority:** P0. **Readiness gaps:** R02, R05, R19, R22.

#### V0.6.16: Updated product threat model

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.16` | Docs, Security | Threat model, parsers, authorization, exports | V0.6.15 |

```text
Update V0.6.16

- Documented trust boundaries introduced by team and integration features
```

**Scope**

- Model untrusted collections, browser reports, identity providers, service tokens, rules, webhooks, source retrieval and admin access; map threats to controls and tests.

**Acceptance**

- Each new boundary has a named owner, misuse case and validating test; unresolved high-impact threats block the release gate.

---

#### V0.6.17: Authorization regression matrix

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.17` | Security, Chore | Threat model, parsers, authorization, exports | V0.6.16 |

```text
Update V0.6.17

- Tested every API operation against roles and project boundaries
```

**Scope**

- Generate negative cases from the permission matrix, including exports, search counts, source digests, approvals, outbox and background jobs.

**Acceptance**

- Every route has a policy decision and isolation test; adding an unclassified route fails CI.

---

#### V0.6.18: Parser and rule fuzzing

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.18` | Security, Chore | Threat model, parsers, authorization, exports | V0.6.17 |

```text
Update V0.6.18

- Fuzzed imported formats and rule execution under strict budgets
```

**Scope**

- Run seeded property-based and mutation fuzzing for Postman, OpenAPI, Bruno, JWT, XML-like bodies and declarative rules without network or script execution.

**Acceptance**

- Crashes and hangs become minimized fixtures; CI enforces time, depth and memory bounds and preserves correct handling of valid inputs.

---

#### V0.6.19: Export injection and leakage corpus

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.19` | Security, Chore | Threat model, parsers, authorization, exports | V0.6.18 |

```text
Update V0.6.19

- Checked all exports for executable content and sensitive data
```

**Scope**

- Test HTML, Markdown, SARIF, CSV and JUnit escaping, spreadsheet formula injection, bidi text, unsafe URLs and secret canaries across core and IAM fields.

**Acceptance**

- No payload executes in supported viewers; external profiles remove configured identifiers and credentials consistently across formats.

---

#### V0.6.20: HTTP and session abuse tests

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.20` | Security, Chore | Threat model, parsers, authorization, exports | V0.6.19 |

```text
Update V0.6.20

- Validated server limits, CSRF defenses and session handling
```

**Scope**

- Exercise oversized and slow requests, invalid encodings, content types, cookie flags, token revocation, proxy bypass and rate-limit evasion through controlled local fixtures.

**Acceptance**

- The server remains available within the abuse budget and rejects unauthorized requests without logging credentials or internal stack details.

---

#### V0.6.21: Dependency and container security coverage

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.21` | Security, Chore | Threat model, parsers, authorization, exports | V0.6.20 |

```text
Update V0.6.21

- Extended scanning to build tools and shipped container contents
```

**Scope**

- Audit runtime and build dependencies, bundled CLI code and base images; pin workflow actions by digest or full SHA and document time-bound advisory exceptions.

**Acceptance**

- A known severe fixture advisory blocks release; exceptions have owner, rationale and expiry, and container contents match the SBOM inventory.

---

#### V0.6.22: Independent security assessment package

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.22` | Docs, Security | Threat model, parsers, authorization, exports | V0.6.21 |

```text
Update V0.6.22

- Prepared reproducible targets and evidence for an external review
```

**Scope**

- Provide threat model, permission matrix, architecture, seeded test deployment and explicit scope for an independent reviewer; keep real customer data out.

**Acceptance**

- An independent reviewer can reproduce the system and record findings by affected boundary; absence of review is shown as an unmet release gate.

---

#### V0.6.23: Security finding remediation verification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.23` | Security, Bug | Threat model, parsers, authorization, exports | V0.6.22 |

```text
Update V0.6.23

- Closed validated security review findings with regression evidence
```

**Scope**

- Implement independently reported high-impact fixes as scoped patches within this release entry or allocate extra versions when needed; rerun affected boundary tests.

**Acceptance**

- No known exploitable critical or high finding remains open at milestone exit; each closed finding has reproduction and regression evidence.

---

### Milestone F4: Operational visibility

**Priority:** P1. **Readiness gaps:** R16, R21.

#### V0.6.24: Redacted operational metrics

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.24` | Feature | Metrics, logs, health, support tooling | V0.6.23 |

```text
Update V0.6.24

- Exposed bounded metrics for service health and throughput
```

**Scope**

- Add opt-in local metrics for API latency, errors, queue depth, jobs and storage usage without collection names, URLs, actor IDs or other high-cardinality labels.

**Acceptance**

- Metrics contain no seeded sensitive strings and remain bounded as project count grows; operators can identify storage and queue pressure.

---

#### V0.6.25: Structured errors and correlation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.25` | Enhancement | Metrics, logs, health, support tooling | V0.6.24 |

```text
Update V0.6.25

- Linked user-facing failures to safe operational diagnostics
```

**Scope**

- Standardize error codes and request or job IDs across UI, CLI and server; keep detailed internal errors in redacted operator logs.

**Acceptance**

- A failed upload can be traced with its ID; neither client responses nor logs reveal raw imported content or credentials.

---

#### V0.6.26: Readiness and alert runbooks

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.26` | Docs, Enhancement | Metrics, logs, health, support tooling | V0.6.25 |

```text
Update V0.6.26

- Added actionable health alerts and recovery instructions
```

**Scope**

- Define alert conditions for unavailable identity, disk limits, invalid keys, audit failure and stuck delivery queues; distinguish degraded optional integrations from unavailable core scans.

**Acceptance**

- Fault injection triggers the documented signal and resolution path; an optional webhook outage does not mark offline analysis unavailable.

---

#### V0.6.27: Diagnostic support bundle

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.27` | Feature | Metrics, logs, health, support tooling | V0.6.26 |

```text
Update V0.6.27

- Generated a reviewable support bundle without collection content
```

**Scope**

- Collect versions, redacted config, error codes, metrics and schema status through an explicit command with preview and exclusion controls.

**Acceptance**

- Secret and identifier canaries are absent; the operator can inspect every included file before sharing it.

---

#### V0.6.28: Scan and policy quality trends

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.28` | Feature | Metrics, logs, health, support tooling | V0.6.27 |

```text
Update V0.6.28

- Added project trends with comparable scan cohorts
```

**Scope**

- Track new and resolved occurrences, age, accepted risk and coverage using fixed policy or explicitly separated policy revisions; avoid mixing incomparable scores.

**Acceptance**

- A policy downgrade is shown as a policy change rather than security improvement; missing scans do not look like zero findings.

---

#### V0.6.29: Portfolio ownership and freshness view

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.29` | Feature | Metrics, logs, health, support tooling | V0.6.28 |

```text
Update V0.6.29

- Added a cross-project view for authorized platform reviewers
```

**Scope**

- Aggregate owned services, stale scans, overdue work and coverage with server-side scope filtering; link to exact source scans and owners.

**Acceptance**

- A restricted reviewer cannot infer hidden projects through totals; every portfolio metric is traceable to accessible evidence.

---

#### V0.6.30: Notification and queue health

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.30` | Enhancement | Metrics, logs, health, support tooling | V0.6.29 |

```text
Update V0.6.30

- Made failed integrations visible without alert storms
```

**Scope**

- Show delivery age, dead letters, retry scheduling and muted destinations in operator and project views; add bounded escalation for sustained failures.

**Acceptance**

- A prolonged outage yields one actionable incident and a recovery update; retries remain bounded and do not flood users or receivers.

---

#### V0.6.31: Operational service objectives

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.31` | Docs, Chore | Metrics, logs, health, support tooling | V0.6.30 |

```text
Update V0.6.31

- Published measured service objectives and support limits
```

**Scope**

- Define availability measurement, maintenance exclusions, capacity and recovery objectives from pilot data; separate targets from contractual commitments.

**Acceptance**

- Reference load tests and restore drills support each published objective; unsupported workloads are explicitly listed.

---

### Milestone F5: Supported self-hosting envelope

**Priority:** P0. **Readiness gaps:** R01, R07, R16.

#### V0.6.32: Single-writer storage protection

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.32` | Security, Enhancement | Deployment, migrations, storage operations | V0.6.31 |

```text
Update V0.6.32

- Prevented unsupported concurrent server writers
```

**Scope**

- Acquire an exclusive deployment lease or filesystem lock for the SQLite and file-store combination; detect stale ownership safely and document supported volume semantics.

**Acceptance**

- A second instance cannot serve writable team APIs against the same data directory; lock recovery requires verified process termination.

---

#### V0.6.33: Production Compose deployment

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.33` | Enhancement, Docs | Deployment, migrations, storage operations | V0.6.32 |

```text
Update V0.6.33

- Added a hardened and upgradeable Compose profile
```

**Scope**

- Provide TLS-proxy integration, health checks, read-only root filesystem where compatible, secret files, resource limits and explicit persistent volumes.

**Acceptance**

- A fresh deployment starts, signs in, stores data, backs up and upgrades under the documented profile without running as root.

---

#### V0.6.34: Single-replica Kubernetes deployment

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.34` | Feature, Docs | Deployment, migrations, storage operations | V0.6.33 |

```text
Update V0.6.34

- Added a Kubernetes recipe with explicit storage constraints
```

**Scope**

- Provide validated manifests or a small chart with one writer, persistent volume, probes, resource limits, secret references and a migration job; do not advertise HA.

**Acceptance**

- A deployment and restart preserve data; replica increases are refused or clearly blocked by the lease; an invalid key fails readiness.

---

#### V0.6.35: Offline deployment verification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.35` | Chore, Docs | Deployment, migrations, storage operations | V0.6.34 |

```text
Update V0.6.35

- Verified installation and operation without external network access
```

**Scope**

- Package required static assets and runtime dependencies; test no-egress browser analysis, local identity configuration where available and offline artifact installation.

**Acceptance**

- Core import, audit, repair and export work with network egress denied; optional connectors fail explicitly without breaking local use.

---

#### V0.6.36: Upgrade and rollback compatibility

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.36` | Enhancement | Deployment, migrations, storage operations | V0.6.35 |

```text
Update V0.6.36

- Added migration preflight and safe rollback guidance
```

**Scope**

- Check schema compatibility, backup availability and disk capacity before upgrade; classify reversible and restore-required migrations and refuse unsupported downgrades.

**Acceptance**

- An upgrade from supported old fixtures preserves IDs and approvals; rollback follows a verified path and never opens a newer schema unsafely.

---

#### V0.6.37: Capacity and contention load tests

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.37` | Chore | Deployment, migrations, storage operations | V0.6.36 |

```text
Update V0.6.37

- Measured supported concurrent team usage
```

**Scope**

- Test authenticated list, read, upload, ingest and review operations with multiple projects, large revisions and slow clients on declared hardware.

**Acceptance**

- The target workload meets p95 latency and error budgets with no lost writes or cross-project leakage; saturation returns bounded errors.

---

#### V0.6.38: Long-running service soak

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.38` | Chore | Deployment, migrations, storage operations | V0.6.37 |

```text
Update V0.6.38

- Checked memory, queues and storage across sustained operation
```

**Scope**

- Run repeated imports, logins, scans, pruning and connector failures over a defined soak window; observe process memory, file handles and backlog recovery.

**Acceptance**

- Resource growth stays within the documented envelope and queues drain after recovery; retained data matches retention rules and scan counts.

---

#### V0.6.39: Operator acceptance checkpoint

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.6.39` | Chore, Docs | Deployment, migrations, storage operations | V0.6.38 |

```text
Update V0.6.39

- Validated deployment, incident recovery and upgrade with an operator
```

**Scope**

- Have a person unfamiliar with the implementation deploy, diagnose a seeded failure, restore backup and upgrade using only docs; record missing steps.

**Acceptance**

- The operator completes the exercise and all F P0 gates pass; unresolved data-loss or recovery failures stop further release qualification.

---

## 11. Track G: Usability, community and public-release qualification

**Outcome:** A new team can adopt the product without maintainer assistance, contributors can sustain it, and a frozen release candidate has complete launch evidence.

### Milestone G1: First-use and everyday product experience

**Priority:** P1. **Readiness gaps:** R18, R21.

#### V0.7.0: Role-oriented start screen

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.0` | Enhancement | Onboarding, project navigation, empty states | V0.6.39 |

```text
Update V0.7.0

- Added clear entry points for developers, reviewers and operators
```

**Scope**

- Offer local scan, existing project, CI setup and deployment help based on actual permissions; preserve a direct no-account local scan path.

**Acceptance**

- A first-time user reaches the appropriate task without navigating unrelated admin features or confusing local and uploaded data.

---

#### V0.7.1: Small-team starter configuration

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.1` | Feature | Onboarding, project navigation, empty states | V0.7.0 |

```text
Update V0.7.1

- Added a minimal team setup with practical defaults
```

**Scope**

- Generate one project, sensible roles, a conservative secret gate and explicit retention settings; explain every required infrastructure dependency.

**Acceptance**

- A small-team pilot reaches a governed scan and assigns its first finding with no manual database editing or hidden external service requirement.

---

#### V0.7.2: Startup adoption guide and samples

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.2` | Docs | Onboarding, project navigation, empty states | V0.7.1 |

```text
Update V0.7.2

- Added a startup workflow from local review to CI
```

**Scope**

- Provide synthetic examples for partner integrations, authentication and public sample publishing with incremental rollout and baseline guidance.

**Acceptance**

- A new startup user reproduces the workflow and understands which checks are advisory, blocking and outside static-analysis coverage.

---

#### V0.7.3: Platform-team adoption guide

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.3` | Docs | Onboarding, project navigation, empty states | V0.7.2 |

```text
Update V0.7.3

- Added a multi-project governance rollout guide
```

**Scope**

- Explain ownership, policy minimums, project boundaries, IAM context, CI provenance and staged adoption; include a migration checklist from shared library use.

**Acceptance**

- A platform pilot applies one common policy to two projects while preserving project-specific settings and access separation.

---

#### V0.7.4: Community publishing workflow

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.4` | Feature, Docs | Onboarding, project navigation, empty states | V0.7.3 |

```text
Update V0.7.4

- Added a guided check before sharing public collections
```

**Scope**

- Combine external privacy profiles, safe sample replacements, repair verification and a final export summary; avoid automatic publication to external services.

**Acceptance**

- A seeded collection exports without configured secrets, personal data or private identifiers; remaining unverified fields are clearly disclosed.

---

#### V0.7.5: Everyday project navigation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.5` | Enhancement | Onboarding, project navigation, empty states | V0.7.4 |

```text
Update V0.7.5

- Added recent projects, accessible breadcrumbs and contextual actions
```

**Scope**

- Unify library, scan, comparison and finding navigation with permission-aware breadcrumbs and preserved query state; keep search scoped and explicit.

**Acceptance**

- Back and forward navigation restore the same project, revision and filters; a revoked project disappears without exposing cached details.

---

#### V0.7.6: Actionable empty and error states

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.6` | Enhancement | Onboarding, project navigation, empty states | V0.7.5 |

```text
Update V0.7.6

- Explained no-results, incomplete scans and recoverable failures
```

**Scope**

- Differentiate empty project, no matching filters, unsupported input, no applicable rules, lost access and failed integration; offer the exact available recovery action.

**Acceptance**

- Each named state has a browser scenario and meaningful text; no-results is never used to hide a failed scan or denied access.

---

#### V0.7.7: Evidence-based UX refinement

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.7` | Enhancement | Onboarding, project navigation, empty states | V0.7.6 |

```text
Update V0.7.7

- Resolved the highest-friction steps from observed team tasks
```

**Scope**

- Use D and E pilot observations to simplify labels, defaults and unnecessary steps; record before-and-after task completion evidence rather than cosmetic preferences.

**Acceptance**

- The five most frequent observed friction points have verified improvements and no regression in privacy explanation or workflow success.

---

### Milestone G2: Inclusive and consistent UX

**Priority:** P0. **Readiness gaps:** R17, R18.

#### V0.7.8: Complete accessibility inventory

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.8` | Chore | Accessibility, responsive layouts, interaction | V0.7.7 |

```text
Update V0.7.8

- Mapped every core page and dialog to an accessibility test
```

**Scope**

- Extend the existing shared page list to include Identity and all team surfaces, with forms, loading, error, empty and permission-denied states.

**Acceptance**

- No shipped primary route or critical dialog is missing from the inventory; each has automated checks and a named manual review owner.

---

#### V0.7.9: Screen-reader workflow verification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.9` | Enhancement | Accessibility, responsive layouts, interaction | V0.7.8 |

```text
Update V0.7.9

- Improved announcements and structure across complete team workflows
```

**Scope**

- Manually review headings, labels, landmarks, live regions, virtualized lists and validation with a declared screen-reader/browser combination.

**Acceptance**

- Import, assign, approve, repair and export are completable without visual cues; issues found are fixed and documented as task-level checks.

---

#### V0.7.10: Keyboard and focus consistency

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.10` | Enhancement | Accessibility, responsive layouts, interaction | V0.7.9 |

```text
Update V0.7.10

- Made navigation and dialogs consistent for keyboard users
```

**Scope**

- Unify shortcuts, focus restoration, skip links and escape behavior; avoid shortcut interception inside inputs and ensure virtualized selection remains visible.

**Acceptance**

- All primary actions work without a pointer; nested dialogs close predictably and focus never becomes trapped or lost.

---

#### V0.7.11: Zoom and responsive review layouts

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.11` | Enhancement | Accessibility, responsive layouts, interaction | V0.7.10 |

```text
Update V0.7.11

- Supported constrained viewports and high zoom for review tasks
```

**Scope**

- Check 200 and 400 percent zoom, narrow desktop and tablet widths, long names and dense tables; provide accessible overflow rather than clipped actions.

**Acceptance**

- Critical actions and error messages remain reachable at tested sizes; essential review content does not require two-dimensional scrolling except genuine data tables.

---

#### V0.7.12: Contrast and non-color status cues

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.12` | Enhancement | Accessibility, responsive layouts, interaction | V0.7.11 |

```text
Update V0.7.12

- Made severity and workflow status understandable in both themes
```

**Scope**

- Verify text, focus, charts and disabled controls against documented accessibility targets; pair color with labels, shapes or patterns.

**Acceptance**

- Light and dark themes meet the agreed contrast criteria and every important chart or state has a text equivalent.

---

#### V0.7.13: Reduced motion and loading behavior

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.13` | Enhancement | Accessibility, responsive layouts, interaction | V0.7.12 |

```text
Update V0.7.13

- Respected motion preferences and made progress states dependable
```

**Scope**

- Apply reduced-motion preferences consistently, avoid distracting repeated effects and preserve context during async actions; expose cancel and retry appropriately.

**Acceptance**

- Reduced-motion tests remove nonessential animation; loading never blocks unrelated navigation or leaves a completed operation appearing pending.

---

#### V0.7.14: Clear terminology and localization readiness

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.14` | Enhancement, Docs | Accessibility, responsive layouts, interaction | V0.7.13 |

```text
Update V0.7.14

- Standardized team-facing language and locale-sensitive formatting
```

**Scope**

- Use consistent terms for collection, revision, scan, occurrence and accepted risk; format dates and numbers by locale without changing policy timestamp semantics.

**Acceptance**

- Terminology is consistent across UI, reports and docs; locale changes do not alter expiry or sorting semantics and long translated strings have layout coverage.

---

#### V0.7.15: Cross-browser and manual accessibility gate

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.15` | Chore | Accessibility, responsive layouts, interaction | V0.7.14 |

```text
Update V0.7.15

- Verified the complete product in supported browsers
```

**Scope**

- Run critical journeys on Chromium, Firefox and WebKit where supported; publish manual WCAG 2.2 AA task review results without claiming certification from axe alone.

**Acceptance**

- The declared browser matrix passes and no critical task is blocked for keyboard or screen-reader users; documented gaps have explicit release decisions.

---

### Milestone G3: Open-source adoption and maintenance

**Priority:** P1. **Readiness gaps:** R20, R22.

#### V0.7.16: Public product documentation

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.16` | Docs | Documentation, governance, contribution workflow | V0.7.15 |

```text
Update V0.7.16

- Published a task-based guide with verified screenshots
```

**Scope**

- Replace placeholder installation URLs and screenshot instructions; document local, CLI and team journeys with current screenshots and supported feature boundaries.

**Acceptance**

- Every quickstart command is exercised from a clean checkout or package; screenshots match the candidate and contain only synthetic data.

---

#### V0.7.17: Discoverable security policy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.17` | Docs | Documentation, governance, contribution workflow | V0.7.16 |

```text
Update V0.7.17

- Added a root security policy and supported-version table
```

**Scope**

- Link private disclosure, response expectations, supported branches and update process from SECURITY.md and the repository settings checklist; do not promise unsupported response SLAs.

**Acceptance**

- A reporter can find the private route without opening a public issue; maintainers can follow a simulated disclosure through triage and patched release preparation.

---

#### V0.7.18: Contributor onboarding

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.18` | Docs, Chore | Documentation, governance, contribution workflow | V0.7.17 |

```text
Update V0.7.18

- Added a reproducible development and contribution guide
```

**Scope**

- Provide CONTRIBUTING.md, local setup, architecture map, scoped checks, synthetic fixture rules and troubleshooting for supported platforms.

**Acceptance**

- A new contributor can run a selected suite and implement a small documented rule fixture without maintainer-specific environment knowledge.

---

#### V0.7.19: Project governance and conduct

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.19` | Docs | Documentation, governance, contribution workflow | V0.7.18 |

```text
Update V0.7.19

- Defined maintainer roles, decisions and community expectations
```

**Scope**

- Document decision ownership, review requirements, code of conduct, reporting route and succession expectations; keep roles realistic for current maintainers.

**Acceptance**

- Release, security and conduct decisions each have an accountable role and a fallback path rather than an unstaffed committee.

---

#### V0.7.20: Issue and pull request templates

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.20` | Chore, Docs | Documentation, governance, contribution workflow | V0.7.19 |

```text
Update V0.7.20

- Added templates that request useful nonsecret evidence
```

**Scope**

- Create bug, feature and rule-accuracy templates with version, reproduction and synthetic fixture guidance; warn against posting raw collections or credentials.

**Acceptance**

- A sample issue and PR contain enough reproduction context without sensitive attachments; templates link support and private disclosure appropriately.

---

#### V0.7.21: Contribution map and starter tasks

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.21` | Docs | Documentation, governance, contribution workflow | V0.7.20 |

```text
Update V0.7.21

- Mapped safe contribution areas and maintenance needs
```

**Scope**

- Identify rule fixtures, adapter coverage, accessibility, documentation and integration recipes with ownership and acceptance expectations; document how to propose scope changes.

**Acceptance**

- At least one newcomer completes a scoped contribution using the guide; tasks do not depend on private infrastructure or realistic tokens.

---

#### V0.7.22: Support and compatibility policy

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.22` | Docs | Documentation, governance, contribution workflow | V0.7.21 |

```text
Update V0.7.22

- Defined supported formats, browsers, runtimes and deployment sizes
```

**Scope**

- Consolidate tested versions, limits, upgrade window, deprecation notice and community support boundaries; clearly state single-writer server constraints.

**Acceptance**

- Every advertised combination has validation evidence; unsupported HA, tenancy and format capabilities are not implied by marketing copy.

---

#### V0.7.23: Maintainer sustainability checklist

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.23` | Docs, Chore | Documentation, governance, contribution workflow | V0.7.22 |

```text
Update V0.7.23

- Added recurring maintenance ownership and release responsibilities
```

**Scope**

- Document dependency updates, rule reference review, triage, backup examples, credential rotation and release handoff as repository tasks; make no automatic external schedules.

**Acceptance**

- A second maintainer can prepare a patch using the checklist; no launch-critical process depends on undocumented personal knowledge.

---

### Milestone G4: Verifiable release distribution

**Priority:** P0. **Readiness gaps:** R01, R20, R23.

#### V0.7.24: CLI package boundary

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.24` | Feature, Chore | Packaging, provenance, release automation | V0.7.23 |

```text
Update V0.7.24

- Prepared an installable CLI package with a defined support surface
```

**Scope**

- Resolve package.json private status through an explicit package split or publish configuration; include only required runtime artifacts, license and docs; preserve root app privacy where appropriate.

**Acceptance**

- npm pack inspection contains no source secrets, test data or unrelated app files; installation in a clean folder exposes a working postscope command.

---

#### V0.7.25: Clean-install artifact tests

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.25` | Chore | Packaging, provenance, release automation | V0.7.24 |

```text
Update V0.7.25

- Tested release artifacts outside the source checkout
```

**Scope**

- Install the packaged CLI and unpack the static app and server artifacts in clean Windows and Linux environments with no developer dependencies.

**Acceptance**

- Version, scan, reports and documented server startup succeed from artifacts; package behavior does not rely on repository-relative files.

---

#### V0.7.26: Container release matrix

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.26` | Chore | Packaging, provenance, release automation | V0.7.25 |

```text
Update V0.7.26

- Prepared versioned containers for supported deployment architectures
```

**Scope**

- Build declared amd64 and arm64 targets where tested, pin base digests and include OCI metadata; verify non-root and offline operation.

**Acceptance**

- Each advertised architecture runs the CLI and authenticated team smoke scenario; unsupported architectures are omitted rather than assumed compatible.

---

#### V0.7.27: Software bill of materials and notices

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.27` | Security, Chore | Packaging, provenance, release automation | V0.7.26 |

```text
Update V0.7.27

- Generated dependency inventories and required license notices
```

**Scope**

- Include build and bundled dependency provenance, base image inventory and license notices in release artifacts; account for bundled code with legal-comments removed.

**Acceptance**

- SBOM contents match inspected artifacts and dependencies; required third-party notices survive bundling and package publication preparation.

---

#### V0.7.28: Signed release provenance

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.28` | Security, Chore | Packaging, provenance, release automation | V0.7.27 |

```text
Update V0.7.28

- Added checksums, artifact signatures and build attestations
```

**Scope**

- Generate verifiable provenance for CLI, static app and containers through least-privilege release automation; document offline checksum and signature verification.

**Acceptance**

- A modified artifact fails verification; an unsigned or mismatched artifact cannot enter the approved release manifest.

---

#### V0.7.29: Rehearsable release workflow

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.29` | Chore | Packaging, provenance, release automation | V0.7.28 |

```text
Update V0.7.29

- Added a release pipeline with draft artifacts and explicit publication
```

**Scope**

- Validate versions, changelog, tags, tests, SBOM and provenance before producing a draft; separate artifact creation from registry or public-site publication.

**Acceptance**

- A dry run produces a complete inspectable release with no public upload; failed checks prevent the publishing stage.

---

#### V0.7.30: Upgrade documentation from V0.2.15

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.30` | Docs, Chore | Packaging, provenance, release automation | V0.7.29 |

```text
Update V0.7.30

- Verified migration instructions from the current public baseline
```

**Scope**

- Exercise current library migration, policy and baseline compatibility, session changes and install commands against preserved V0.2.15 fixtures.

**Acceptance**

- An operator upgrades an encrypted and an unencrypted fixture with matching data and explicit new access settings; unsupported downgrades are explained.

---

#### V0.7.31: Release artifact recovery rehearsal

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.31` | Chore | Packaging, provenance, release automation | V0.7.30 |

```text
Update V0.7.31

- Verified rollback and replacement of a defective draft release
```

**Scope**

- Simulate a bad package and migration in isolated fixtures; document withdrawing an unpublished candidate, rebuilding with new versioning and restoring service.

**Acceptance**

- The rehearsal restores the prior supported service and verifies data; it does not reuse a published tag or silently replace artifact bytes.

---

### Milestone G5: Beta evidence and release decision

**Priority:** P0. **Readiness gaps:** R08, R16, R17, R23.

#### V0.7.32: Private beta evaluation protocol

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.32` | Docs | Pilot validation, security, reliability, release gates | V0.7.31 |

```text
Update V0.7.32

- Defined a consent-based beta across target team types
```

**Scope**

- Recruit at least one startup, one small team, one platform team and one community maintainer if available; use synthetic or voluntarily redacted data and state sample limitations.

**Acceptance**

- The protocol records goals, tasks, consent, retention and success criteria; lack of participants remains an unmet gate rather than fabricated validation.

---

#### V0.7.33: Startup and small-team beta review

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.33` | Chore, Enhancement | Pilot validation, security, reliability, release gates | V0.7.32 |

```text
Update V0.7.33

- Resolved observed onboarding and daily-use blockers in small-team pilots
```

**Scope**

- Measure setup time, time to first useful finding, successful remediation and false-positive burden over repeated use; implement verified fixes within scope.

**Acceptance**

- Both cohorts complete two review cycles without maintainer intervention; high-impact observed issues have a regression scenario and are closed.

---

#### V0.7.34: Platform and community beta review

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.34` | Chore, Enhancement | Pilot validation, security, reliability, release gates | V0.7.33 |

```text
Update V0.7.34

- Resolved governance and safe-sharing blockers in broader pilots
```

**Scope**

- Exercise isolation, policy rollout, service ownership and public collection export with distinct roles; record actual usage constraints and conflicting needs.

**Acceptance**

- Platform users can trace an approved scan to its commit and community users can produce a safe external export; blocker findings are resolved.

---

#### V0.7.35: Detection and repair qualification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.35` | Chore | Pilot validation, security, reliability, release gates | V0.7.34 |

```text
Update V0.7.35

- Published candidate detection and repair quality evidence
```

**Scope**

- Run the held-out labeled corpus, source-format suite and repair invariants against the candidate; disclose per-family misses, false positives and incomplete coverage.

**Acceptance**

- All synthetic critical leak cases and repair non-regression invariants pass; any material miss is resolved or explicitly removes the affected capability from the release claim.

---

#### V0.7.36: Security and privacy sign-off evidence

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.36` | Security, Chore | Pilot validation, security, reliability, release gates | V0.7.35 |

```text
Update V0.7.36

- Revalidated security boundaries on the release candidate
```

**Scope**

- Rerun independent review regressions, authorization matrix, report leakage corpus and no-egress checks after final feature changes; record remaining accepted lower-risk issues.

**Acceptance**

- No known exploitable critical or high issue, cross-project exposure or credential leak remains; review evidence names the exact candidate revision.

---

#### V0.7.37: Reliability and performance qualification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.37` | Chore | Pilot validation, security, reliability, release gates | V0.7.36 |

```text
Update V0.7.37

- Revalidated workload, recovery and responsiveness on the candidate
```

**Scope**

- Run the published reference benchmarks, load scenario, soak, backup restore and migration checks on frozen artifacts; record hardware and all failed attempts.

**Acceptance**

- Candidate meets declared p95, memory, error, RPO and RTO targets; unexplained failures prevent sign-off even when a rerun passes.

---

#### V0.7.38: Documentation and usability qualification

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.38` | Chore, Docs | Pilot validation, security, reliability, release gates | V0.7.37 |

```text
Update V0.7.38

- Verified clean adoption and accessible task completion
```

**Scope**

- Have independent users follow install, CI, triage, repair, sharing and operator guides against the candidate; include keyboard and screen-reader task reviews.

**Acceptance**

- At least 80 percent of representative core tasks finish unassisted, all critical accessibility tasks work and no documented install route fails.

---

#### V0.7.39: V1.0 readiness decision and release manifest

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v0.7.39` | Chore, Docs | Pilot validation, security, reliability, release gates | V0.7.38 |

```text
Update V0.7.39

- Recorded the evidence and remaining limits for the first public release
```

**Scope**

- Create a go or no-go record for every section 12 gate, final artifact digests, compatibility promises, known limitations and support owners; prepare the exact public release notes.

**Acceptance**

- All mandatory gates have dated evidence for one candidate; any failed gate extends V0.7.x or schedules V0.8.x explicitly instead of declaring readiness by commit count.

---

## 12. V1.0.0 readiness gates

These are proposed targets, not claims about the current release. Freeze fixtures and reference hardware during C2; any change to a target needs recorded pilot evidence. All evidence must identify the final candidate revision.

| Gate | Required evidence | Checkpoints |
|---|---|---|
| Functional adoption | At least 80 percent unassisted core task completion across startup, small-team, platform and community participants; disclose sample size; no blocked critical workflow | D5, E5, G5 |
| Detection and repair | All synthetic critical-secret fixtures pass; publish held-out precision and recall by rule family and known misses; target 95 percent literal-secret precision on the labeled corpus; repair changes only intended fields | D3, D4, G5 |
| Governance | Personal overrides, forged reports, expired exceptions and stale approvals cannot satisfy a trusted gate | C5, D2, E1 |
| Security and privacy | Independent assessment completed; no known exploitable critical or high issue; all isolation tests pass; no credential canaries in reports, logs or integrations; no core-analysis egress | C1, C3, F3, G5 |
| Responsiveness | Proposed desktop reference: 4 cores, 8 GiB RAM; p95 first usable result under 2 seconds for 1000 requests / 5 MB and under 15 seconds for the 6120-request reference; search under 200 ms; cancellation under 1 second | C2, F1 |
| Memory | Proposed peak browser working set under 512 MiB for the 6120-request reference; explicit limits and visible truncation for larger inputs | C2, F1 |
| Team capacity | Proposed server reference: 4 vCPU, 8 GiB RAM, local SSD; 20 concurrent users, 10 API requests/second, 10000 metadata records; p95 reads under 500 ms and writes under 2 seconds; under 1 percent unexpected errors; no lost acknowledged changes | F4, F5 |
| Recovery | Backup and restore plus upgrade from V0.2.15 and the prior candidate verified; proposed backup RPO at most 24 hours and restore RTO at most 60 minutes, conditional on operator backup schedule | C4, F2, F5 |
| Accessibility | No serious or critical axe violations in covered states plus manual keyboard, screen-reader, zoom and contrast task review against WCAG 2.2 AA; automation alone is not certification | D5, G2 |
| Compatibility | All advertised runtime, OS, browser and input-format combinations pass; report, policy and baseline migrations documented | C2, E3, G4 |
| Distribution | Clean install, offline artifacts, SBOM, notices, checksums, signatures and release provenance verified | G4 |
| Maintenance | Named release/security maintainers, private disclosure route, supported-version policy, task-based docs and truthful known limitations | G3, G5 |

Use at least 30 measured interactive runs for typical-workload percentile claims. Report p50, p95, cold/warm conditions, hardware, fixture size and memory methodology. Publish load and soak duration and error distributions. Fastest-of-nine Node engine timings cannot substitute for browser p95.

### Conditional V1.0.0 release

| Tag | Type | Area | Depends on |
|---|---|---|---|
| `v1.0.0` | Chore, Docs | First public release | V0.7.39 and every mandatory gate above |

```text
Update V1.0.0

- Published verified release artifacts and installation instructions
- Documented supported workflows, compatibility guarantees and known limits
```

**Scope:** Publish only artifacts approved in the candidate manifest; align versions and changelog; define 1.x contracts for CLI exit codes, rule identifiers, configuration, baselines, reports and supported APIs. This release is excluded from the 200-commit count.

**Acceptance:** Every mandatory gate has dated candidate-specific evidence and a clean installation from the public artifacts passes the approved smoke checks. No failed gate can be waived solely to meet a date or commit count.

### Deliberate later backlog

Multi-writer HA/PostgreSQL, hosted multi-tenant SaaS, live API execution, secret-validity probes, AI remediation and MCP services require separate validated demand and threat models. Insomnia, HAR, AsyncAPI, native Jira/Linear integrations and additional languages require repeated pilot needs and maintenance capacity. Use external issue links, webhooks and specialist runtime scanners meanwhile. Static findings and compliance mappings do not establish runtime security or certification.

## 13. Maintenance of this file

- Add actual commit hashes only when versions ship; retain historical plans and record deviations in the changelog.
- Keep historical F1 to F15 and current R01 to R24 references stable.
- Update overview rows, detail sections, dependencies and counts together when splitting or moving unshipped work.
- Reassess scope after each pilot. Keep the requested minimum of 200 meaningful deliverables; replace invalidated work with evidence-backed needs rather than empty changes.
