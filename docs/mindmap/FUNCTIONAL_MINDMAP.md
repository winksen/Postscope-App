# PostScope: Functional Mindmap

> **Audience:** product owners, reviewers, new teammates, and operators who need to know *what PostScope does* without reading code.
> **Companion:** [TECHNICAL_MINDMAP.md](TECHNICAL_MINDMAP.md) covers *how* it works. [../SECURITY.md](../SECURITY.md) covers the threat model and operator checklist. [../DEPLOYMENT.md](../DEPLOYMENT.md) covers running it.
> **Scope:** reflects the code on 2026-10-07 (after release V0.1.23 plus the core/security hardening pass).

---

## The product in one paragraph

PostScope is a **Postman collection auditor**. A user drops an exported collection (or pastes its JSON) and PostScope parses it **in the browser**, finds **hardcoded secrets, auth gaps, insecure transport, and hygiene problems**, scores the collection, and offers **safe automatic repairs**. Results can be exported as **Markdown, JSON, or SARIF** reports, and a **sanitized copy** of the collection (credentials replaced with `{{variables}}`) can be downloaded for safe sharing. Teams can optionally keep a **shared library** of collections on the PostScope server, and a **CLI** runs the same audit in CI pipelines.

---

## Overview

```mermaid
mindmap
  root((PostScope))
    Import
      Drag and drop / browse
      Paste JSON
      Sample collections
      Team library
      Session restore
    Analyze
      Dashboard overview
      Requests explorer
        Secret masking
      Security findings
        Masked evidence
        CWE / OWASP refs
      Hygiene notes
      Score and grade
      Deep links and back button
      Keyboard and screen reader use
      Large collections stay fast
      Compare versions
        New and resolved findings
        Score change
        Added and changed requests
    Act
      Repair center
        Safe auto fixes
        Risk levels
      Rule settings
        Disable rules
        Override severity
        Team defaults
      Export
        Markdown report
        JSON report
        SARIF for CI
        Sanitized collection
    Share
      Team library
        Consent in hybrid mode
        De-duplication
        Retention and quotas
        Server-side redaction
    Automate
      CLI scan
      Fail on severity
      Minimum score
      Diff two versions
    Protect
      Browser-only by default
      Basic auth gate
      Rate limits
      Strict CSP
```

---

## 1. Users and deployment modes

**Who uses it:** API developers, QA engineers, security reviewers, and platform teams who share Postman collections and need to know whether those exports leak credentials or are hard to maintain.

**One setting decides where collections live** (`LOGGING_MODE`):

| Mode | What users see | Storage |
|---|---|---|
| `off` (default) | "Public mode: incognito only" | Nothing is stored on the server. Analysis stays in the browser. |
| `hybrid` | A choice between **Incognito** and **Save to history** with an upload warning that must be accepted | Only collections the user explicitly saves |
| `on` | "Mandatory logging" notice | Every imported collection is saved to the team library |

`PUBLIC_LANDING_PAGE=true` adds a marketing homepage at `/` and moves the analyzer to `/analyze`.

## 2. Importing a collection

| Way in | Behavior |
|---|---|
| Drag and drop / Browse | Accepts `.json` and `*.postman_collection.json`, plus any number of `*.postman_environment.json` and `*.postman_globals.json` files in the same drop (one collection, or two collections to compare them with the older one first; environment files alone are refused). Empty files and files over 50 MB are refused with a clear message. |
| Paste JSON | Validates that the text is JSON with `info` and an `item` array before importing. |
| Sample collections | Four bundled demos: clean default, large messy enterprise collection, secrets + auth, intentionally vulnerable. |
| Team library | "Recently saved" list on the import page and a full library dialog (open, export, remove). |
| Session restore | In history/on modes the last collection, its environment files and the selected environment survive a page refresh (same tab, ≈4.5 MB limit). |
| Environments | The header shows the loaded environment, or a selector when several are loaded. The selected environment (then collection variables, then globals) is used to resolve `{{baseUrl}}`, so transport checks such as plaintext HTTP follow the environment you test against. Environment files are not saved to the team library. |

Analysis runs in a **background worker**, so the page stays responsive even for very large collections. If a file is only partly readable (malformed folders, broken items), PostScope imports what it can and shows a notice listing what was skipped. Errors appear as dismissible notifications rather than blocking pop-ups.

## 3. Understanding the results

| Page | Purpose |
|---|---|
| **Dashboard** | Request, folder, and variable counts; method and auth distribution charts; collection structure tree. |
| **Requests** | Postman-like explorer: folder tree, request details (URL, query params, headers, body), and per-request findings with a health score. Credential values are **masked** until the user clicks the eye icon. |
| **Security** | All security-impact findings with severity/category filters and search. The detail dialog shows the recommendation, affected requests, **masked evidence** (where each issue was found), and **CWE / OWASP API Top 10** references. |
| **Hygiene** | Maintainability notes: missing descriptions, unused collection variables, duplicate or placeholder names, loose root requests, deep nesting, empty headers, GET requests with bodies. |
| **Compare** | Compares the open collection (the newer version) with an older one chosen from a file or from the team library. Shows the score change, **new** findings (present now, not before), **resolved** findings, and requests that were added, removed or edited, plus new hosts and auth types. Requests are recognized by id, then by method and URL, so a rename or move does not count as a removal plus an addition, and the findings of a renamed request stay "unchanged". Nothing is stored. Also reachable from the library dialog (**Compare**) and by dropping two collections on the import page (older first). |
| **Score** | A headline 0–100 score and letter grade (A–F) made of a **security score** (secrets, variables, auth; 85%) and a **hygiene score** (15%), per-category scores, a per-finding penalty breakdown, and improvement advice. A finding that affects more requests costs more points, up to a cap per rule, so one noisy rule cannot zero the score alone. Teams can change the point values with `SCORE_WEIGHTS`. |

### What gets detected

| Severity | Finding | Example |
|---|---|---|
| Critical | Hardcoded password | `"password": "S3cret!"` in a body, `X-Password` header |
| Critical | Hardcoded Authorization token | `Authorization: Bearer eyJ…`, session cookies, `X-Auth-Token` |
| Critical | Hardcoded API key | `X-API-Key: k3y…` |
| Critical | Hardcoded secret in request body | `client_secret`, `refresh_token` literals |
| Critical | Hardcoded credential in auth settings | Postman Bearer/API key/OAuth/AWS helper with a literal token, at request, folder, or collection level |
| Critical | Secret passed in query string | `?api_key=…`, `?sig=…` |
| Critical | Credentials embedded in URL | `https://admin:pass@host` |
| Critical | Hardcoded secret in script | `pm.environment.set("token", "abc…")`, `pm.request.headers.add({ key: 'Authorization', value: 'Bearer abc…' })`, `pm.sendRequest` headers, `btoa('user:password')` |
| Critical | Secret stored in an environment or globals file | `clientSecret`, `secret` typed variables and token-shaped values in `*.postman_environment.json` |
| Critical | Secret stored in collection variable | `clientSecret = cs-0a1b…` exported with the collection, or defined on a folder or request |
| Critical | Secret in saved example response | Captured `access_token` or `Set-Cookie` in an example, or a password in the example's original request body |
| Critical | Secret pasted into documentation | `password: …` or `Authorization: Bearer …` in a collection, folder or request description |
| Critical | Provider token detected | AWS, GitHub, Slack, Stripe, Google, OpenAI, Anthropic, JWT, private keys, Entra ID, Okta, Vault, Postman, Atlassian, Shopify, Grafana, Hugging Face, Databricks, PyPI, Square, … |
| Critical | Retrieved secret captured | A saved example of a CyberArk, BeyondTrust, Delinea, Vault or cloud secret manager retrieval that holds the secret (identity packs) |
| Critical | Vault or PAM session token stored | `X-Vault-Token`, `PS-Auth`, a CyberArk logon token or a Delinea bearer token as a literal |
| Critical | Vault root token used or generated | `sys/generate-root`, or `X-Vault-Token: root` |
| Critical | SAML assertion captured | A `SAMLResponse` form field, query, raw body or saved example that decodes to a SAML assertion (identity packs) |
| Critical | Unsigned JWT | A stored token with `alg: none` (identity packs) |
| Critical | OAuth or OpenID Connect endpoint over plain HTTP | A token, introspection or revocation endpoint called with `http://` (identity packs) |
| Critical | Token or authorization code in a URL | `#access_token=…`, `?code=…` with a literal value, including saved example requests (identity packs) |
| Warning | Long-lived or non-expiring access token | A stored JWT with no `exp`, or `exp - iat` over 24 hours |
| Warning | Personal data or privilege claims in a stored token | `email`, `name`, `phone_number`, `roles`, `groups`, `entitlements` in a token that is saved in the collection, with values masked |
| Warning | ID token sent as a bearer token | A token with `nonce` or `at_hash` in an `Authorization: Bearer` header to an API |
| Warning | SAML endpoint over plain HTTP | A single sign-on, assertion consumer or metadata URL with `http://` |
| Info | Session cookie saved without security flags | A saved `Set-Cookie` or stored cookie such as `JSESSIONID` without `Secure`, `HttpOnly` or `SameSite` |
| Info | Tokens obtained but never revoked | Token requests for a platform with no revocation, logout or session termination request |
| Info | Expired token still stored | A JWT whose `exp` is in the past |
| Warning | SCIM PATCH that changes roles, groups or account state | `add roles`, `replace active`, `add members`; a warning when the value is a literal admin role or group, information otherwise |
| Warning | Destructive or unguarded SCIM bulk | `DELETE` operations in `/Bulk`, or 20 or more operations without `failOnErrors` |
| Info | SCIM list without filter or paging | `GET /Users` or `/Groups` with no `filter`, `count` or `startIndex` |
| Info | SCIM protocol details | A body without `application/scim+json`, or without the core schema URN (`User`, `Group`, `PatchOp`, `BulkRequest`) |
| Info | Joiner requests without a leaver step | Accounts are created for a platform but nothing disables, deactivates or suspends them |
| Info | Account deleted without a disable step first | A `DELETE` of a user with no earlier disable in the same folder or sibling folders |
| Info | Account disabled without revoking sessions or tokens | A disable with no session termination, logout or token revocation for the platform |
| Warning | Personal data in a saved example | Emails, phone numbers, IBANs, card numbers, national ids, dates of birth or employee ids in an example response or its original request, with masked values (identity packs) |
| Info | Personal data in a request body | The same kinds of data written into a request body |
| Info | Requester approves their own request | An access request or certification body names the same literal as approver and requester |
| Warning | Bulk approval of certification items | Five or more approve decisions in one call, or a bulk approval endpoint |
| Warning | Credential retrieval without a reason or ticket | A password retrieval or checkout with no `reason`, `comment` or `TicketId` field |
| Warning | Privileged account name used as a literal credential | `administrator`, `root`, `sa`, `krbtgt` or a break-glass name as a username |
| Info | Safe, policy or permission change | CyberArk safe members, Vault ACL policies, BeyondTrust and Delinea permissions; a warning when it grants full permissions |
| Info | Checkout without a check-in | A PAM platform with checkouts and no check-in or release request |
| Warning | Top-tier role assigned as a literal | Okta `SUPER_ADMIN`, Entra Global Administrator, Keycloak `realm-admin`, AWS `AdministratorAccess`, Azure Owner |
| Warning | Policy change that weakens MFA | A factor turned off, enforcement `none`, MFA not required, or every user excluded in a policy or conditional access body |
| Info | Request that creates credentials | Entra `addPassword`, Okta app secrets and API tokens, Keycloak `client-secret`, AWS `CreateAccessKey`, Google service account keys; a warning when the response is saved |
| Info | Tenant identifier repeated as a literal | `acme.okta.com`, a tenant GUID, a realm or a PingOne environment id written in three or more requests instead of `{{oktaDomain}}`, `{{tenantId}}`, `{{realm}}`, `{{envId}}` |
| Warning | Preview and production tenants in one collection | `oktapreview.com` with `okta.com`, dev and production Auth0 tenants, several Entra tenant ids |
| Warning | Retired or legacy identity API | Azure AD Graph, Entra v1.0 `/oauth2/token`, Keycloak `/auth/` prefix, Okta `/api/v1/authn`, Auth0 `/oauth/ro` |
| Warning | Deprecated OAuth grants | Implicit grant (`response_type=token`) and password grant, in requests and in Postman OAuth 2.0 helpers |
| Warning | Authorization code flow without PKCE, or with `plain` | A public client that sends no `code_challenge`, or `code_challenge_method=plain` |
| Warning | Unsafe redirect URI | `http://` to a remote host, wildcards, user info, `?next=https://…` |
| Warning | Over-broad OAuth scope | `*`, `admin`, `okta.users.manage`, `Directory.ReadWrite.All`, Google `cloud-platform`, `.default` on a public client, … |
| Info | Authorize request without state | No `state`, no PKCE and no OpenID `nonce` |
| Info | Client secret sent in the body | `client_secret_post` where `client_secret_basic` or `private_key_jwt` is available |
| Warning | High-entropy literal in a credential field | A long random-looking value in a field such as `X-Webhook-Secret` or `signing_key` that no other rule recognized |
| Warning | Hardcoded base URL / environment URL | `https://api.prod.example.com/…` instead of `{{baseUrl}}`; environment names are matched in the host (`prod`, `staging`, `uat`, `qa`, `dev`, `sandbox`, ...), not in path segments |
| Warning | Potentially unprotected mutation request | `POST` without auth (inherited auth, API key headers, cookies, query credentials and scripts that set `Authorization` are respected) |
| Warning | Basic auth with literal credentials | Username/password typed into Basic auth |
| Warning | Plaintext HTTP endpoint | `http://` to a non-local host, including via `{{baseUrl}}` |
| Warning | TLS certificate verification disabled | `strictSSL: false` |
| Warning | Sensitive value logged by script | `console.log(pm.environment.get("token"))` |
| Warning | Variables referenced but never defined | `{{tenant}}` used in a URL or header, or `pm.environment.get('x')`, but no variable, environment or script provides it. Shown as info when no environment is loaded, because the value may live there |
| Info | Collection variables that are never used | Defined but not referenced by any request, script, auth setting or other variable |
| Info | Expired or malformed suppression | A `postscope-ignore` line or config suppression that no longer applies |
| Info | Hygiene and structure notes | Descriptions, duplicates, placeholders, nesting, few variables, many auth types, GET with body |

Entries that are switched off in Postman (disabled headers, query params, form fields, scripts) are still checked for secrets, because they stay in the exported file. Their evidence is labelled `(disabled)` and the Requests page shows them greyed out with a **Disabled** badge. Repair and the sanitized copy cover them too.

Raw bodies are checked even when they contain Postman variables: `{"id": {{userId}}, "password": "S3cret!"}` is flagged, and so are SOAP/XML bodies (`<wsse:Password>literal</wsse:Password>`) and form-like text (`client_secret=...`). Repair and the sanitized copy replace only the literal and keep the variables and the body layout intact.

Values that are clearly placeholders (`<string>`, `changeme`, `your-api-key`, `demo-…`) or variables (`{{token}}`, `{{auth-token}}`) are not reported.

## 4. Acting on the results

### Repair center

Every finding becomes a repair suggestion. **Auto** fixes can be selected and applied; **manual** items explain what a human must decide. Each fix shows a before/after preview and a risk level:

| Risk | Selected by default | Examples |
|---|---|---|
| Low | Yes | Move API key headers or Basic auth to variables, disable empty headers, add starter variables |
| Low | No | Add empty placeholders for undefined variables |
| Medium | Yes (descriptions: no) | Replace base URLs with variables (one per host, the most used host keeps `{{baseUrl}}`), move tokens, passwords, query secrets, and auth-helper secrets to variables, clear secret collection variables |
| Medium | No | Re-enable TLS verification |
| High | No | Upgrade `http://` endpoints to `https://` |
| Manual | n/a | Scripts, saved responses, credentials in URLs, provider tokens, naming and structure |

After applying, PostScope re-analyzes the repaired collection, shows the real score change, and lets the user export the repaired JSON or reset to the original.

### Rule settings

The sliders icon in the header opens **Rules**: turn any rule off or change its severity. Changes re-run the audit instantly and are remembered in the browser. Operators can ship **team defaults** (`AUDIT_DISABLED_RULES`, `AUDIT_SEVERITY_OVERRIDES`, `AUDIT_RULE_PACKS`); "Reset to defaults" returns to them.

Rules belong to **packs**. The core pack always runs. The four identity packs (access management, governance and provisioning, privileged access, platform profiles) are `Auto` by default: they switch on when a collection shows identity signals such as OAuth helpers, `/oauth2/` or `/scim/` paths, or identity platform hosts. Each pack can be forced `Always on` or `Off` in the Rules dialog. Identity findings use the **Identity** category, which has its own score that appears on the Score page only when the collection has identity findings, and a filter on the Security page.

### Privileged operations inventory

Role assignments, policy and conditional access changes, credential creation, safe and vault administration, secret retrievals and vault writes are listed per platform. State-changing admin operations and secret retrievals are marked as the **danger zone**, and a role assignment that names a top-tier role carries its name. The list is part of the JSON report and feeds the Identity page.

### Governance APIs and personal data

Requests to identity governance products are recognized by what they do: SailPoint Identity Security Cloud and IdentityIQ (access requests, certifications, campaigns, separation of duties policies and violations), Saviynt (`createrequest`), One Identity Manager (`PersonWantsOrg`) and Omada. Access requests and certifications are checked for self-approval and bulk approval, and every request body and saved example is scanned for personal data. Previews are always masked (`j•••@•••`, `FR76••••`, `••••1111`).

### Joiner, mover, leaver map

Identity requests are classified by what they do to an account: **joiner** (create), **mover** (attribute, group or role change) and **leaver** (disable, remove access, revoke sessions or tokens, delete). The profile counts them per platform, which shows at a glance whether a platform can onboard people but not offboard them. The map is part of the JSON report.

### SCIM inventory

For provisioning collections the identity profile also lists each SCIM target system (host or variable), the resources it touches (Users, Groups, Bulk, Schemas) and how many requests of each method go to it. It is part of the JSON report.

### Token inspector

When a request holds a JWT (in a header, an auth helper, a query parameter, a body or a saved example), its details dialog gets a **Token** tab. It shows the header (`alg`, `typ`, key id), the issuer host, the expiry and lifetime, and every claim with a masked value: emails as `j•••@•••`, lists as `[3 values]`, identifiers cut to four characters. The signature is never shown and never checked, and the token is decoded in your browser.

### Identity detection

When a collection looks like it deals with identity (OAuth helpers, `/oauth2/` or `/scim/` paths, identity platform hosts, vault or PAM APIs), PostScope builds an **identity profile** from the export alone: which platforms it talks to (Okta, Microsoft Entra ID, Auth0, Ping Identity, ForgeRock, Keycloak, SailPoint, Saviynt, One Identity, Omada, CyberArk, BeyondTrust, Delinea, HashiCorp Vault, AWS IAM, Azure and Google Cloud IAM, each with a confidence), what each identity request does (token, authorize, SCIM, role assignment, credential retrieval and so on), the OAuth clients with their grant, client authentication method, PKCE state, redirect URIs and scopes, and the literal tokens it holds. Client ids and tokens are always masked. The profile is part of the JSON report. Nothing is sent anywhere: PostScope never calls the identity platform.

### Export

The download icon in the header offers:

| Export | Use |
|---|---|
| Markdown report | Pull requests, tickets, audit evidence |
| HTML report | One self-contained file (no scripts, no external requests) that opens offline, prints cleanly and can be attached to tickets or reviews |
| JSON report | Dashboards and custom tooling. Versioned (`reportVersion: 2`) and described by `docs/schemas/postscope-report.v2.schema.json` |
| SARIF report | GitHub code scanning, Azure DevOps, other CI security dashboards. Results carry the line and column of the offending value in the collection file |
| Sanitized copy | A runnable collection with every detected credential replaced by `{{variables}}` / `{{REDACTED}}`, safe to share |
| Sanitized copy (remove personal data) | The same, and personal data in request bodies and saved examples is replaced too: `{{email}}`, `{{phoneNumber}}`, `{{iban}}` and similar in requests, `{{REDACTED}}` in examples. CLI: `--sanitize out.json --redact-pii` |

Reports never include full secret values, only masked previews.

## 5. Team library

Available in `hybrid` and `on` modes.

- **Consent first (hybrid):** users must accept an upload warning before anything is stored.
- **No duplicates:** saving identical content returns the existing entry ("Already in the team library").
- **Operator policies:** maximum items, retention in days, total size quota, optional server-side **secret redaction** before storing, and an option to **disable removal** for audit trails.
- **Library dialog:** open, compare with the open collection, export JSON, or remove (when allowed). Load errors show a retry button instead of failing silently. When the operator uses single sign-on, each entry shows who saved it ("by alice@example.com").
- **Encryption at rest (optional):** with an operator-provided key, collections are stored encrypted on the server's disk and in its backups. The dialog says so. Tampered files are skipped.
- **Audit trail (default on):** the server logs who saved, opened and removed which collection, and when. It never logs collection content.

## 6. CI automation (CLI)

`postscope scan <file | folder | glob …>` (or `npm run scan -- …` from a clone) runs the exact same audit outside the browser. Folders are searched for `*.postman_collection.json`, quoted globs such as `"collections/**/*.postman_collection.json"` are expanded by the tool, and `--auto-env` adds the environment and globals files stored next to each collection. The CLI is compiled to a single JavaScript file, so CI needs only Node.js 20.6 or newer. Ready-made setups for GitHub Actions (a composite action with SARIF upload), GitLab CI, Azure DevOps and a pre-commit hook are in [../CI.md](../CI.md).

| Flag | Effect |
|---|---|
| `--format text|json|sarif|markdown|html|junit` | Report format (multiple files merge into one JSON array, one SARIF log, one HTML document or one JUnit file). `junit` is for the tests tab of GitLab, Azure DevOps and Jenkins: findings at or above `--fail-on` are failed tests, lower ones pass with details, suppressed ones are skipped |
| `--fail-on critical|warning|info|none` | Exit code 1 when findings at or above this severity exist (default: critical) |
| `--min-score N` | Exit code 1 when a collection scores below N (headline score; thresholds chosen before V0.1.36 may need adjusting) |
| `--weights critical=N,warning=N,info=N` | Override the points deducted per finding severity |
| `--disable`, `--severity` | Same rule policy controls as the UI |
| `--packs auto|none|PACK,-PACK` | Rule packs: `auto` (default), a list of packs to force on, `-pack` to force one off, `none` for no identity packs |
| `--sanitize out.json` | Write a sanitized copy; sanitized environment copies are written next to it as `<name>.sanitized.postman_environment.json` |
| `-e, --environment file.json` | Analyze a Postman environment export with the collections (repeatable) |
| `--globals file.json` | Analyze a Postman globals export with the collections (repeatable) |
| `--config file`, `--no-config` | Use a specific project config, or ignore the `.postscope.json` that would be found above the scanned file |
| `--baseline file` | Report and fail only on findings that are not in the baseline file |
| `--write-baseline file` | Record the current findings as a baseline and exit 0 |
| `--auto-env` | Also analyze the environment and globals files stored next to each collection |
| `postscope diff old.json new.json` | Compare two versions: new and resolved findings, score change, request changes. `--fail-on-new critical\|warning\|info\|none` (default critical) exits 1 when a finding at or above that severity is new; `--format text\|json\|markdown`; `--output file`; same rule options as `scan` |
| `--list-rules` | Print the rule catalog |
| `--version` | Print the PostScope version (same value as the app, Docker image and `/api/config`, from any directory) |

Exit codes: `0` pass, `1` policy failure, `2` usage or input error.

### Project config, baselines and suppressions

A `.postscope.json` found in the scanned file's folder or any parent (or passed with `--config`) sets team defaults. Command line flags add to it or override it. Unknown keys, unknown rule ids and suppressions without a reason are errors, so typos never silently weaken the policy.

```json
{
  "disabledRules": ["GET_WITH_BODY"],
  "severityOverrides": { "INSECURE_HTTP": "critical" },
  "weights": { "critical": 20, "warning": 8, "info": 2 },
  "rulePacks": { "enabled": ["iam-am"], "disabled": ["iam-pam"] },
  "suppressions": [
    { "ruleId": "MISSING_AUTH", "request": "Public/**", "reason": "Public endpoints by design", "expires": "2027-01-31" }
  ]
}
```

| Feature | Behavior |
|---|---|
| Suppressions | Hide specific occurrences of a rule (`request` is a glob on the request id, `location` a substring of the evidence location) with a mandatory `reason` and an optional `expires` date. An expired suppression stops applying and raises `SUPPRESSION_EXPIRED` |
| Inline suppressions | A line `postscope-ignore RULE_ID: reason` (optionally `RULE_ID expires=YYYY-MM-DD: reason`) in a request, folder or collection description. Missing reason, unknown rule or bad date: not applied, `SUPPRESSION_INVALID` raised |
| Suppressed occurrences | Stay in the reports (JSON `suppressed`, SARIF `suppressions`, Markdown section, the **Show: Suppressed** view on the Security page) but do not count toward the score or `--fail-on` |
| Baseline | `--write-baseline` stores a fingerprint (a SHA-256 of rule, request and location, no values) for every current occurrence; `--baseline` then hides those, so CI fails only on new ones. Commit the baseline file and refresh it when findings are fixed |
| Fingerprints | Also exported per occurrence in the JSON report and as `postscope/v2` SARIF fingerprints |

## 7. Privacy and security guarantees (user view)

- In `off` mode (default) collections never leave the browser.
- Credentials are masked on screen until revealed; reports and the CLI only show masked previews.
- Optional sign-in gate (HTTP Basic auth) for internal deployments, with lockout after repeated failures.
- The server rejects cross-site requests, oversized uploads, malformed IDs, and path tricks; it applies a strict Content Security Policy.

Full details: [../SECURITY.md](../SECURITY.md).

### Links and keyboard

| Feature | Behavior |
|---|---|
| Page addresses | Each page has its own address: `/security`, `/hygiene`, `/requests`, `/repair`, `/score`, `/compare` (below `/analyze` when the landing page is public). The browser back and forward buttons move between pages |
| Filters | Severity, category, rule and the Suppressed view are part of the address of the Security and Hygiene pages, for example `/analyze/security?severity=critical&rule=HARDCODED_TOKEN`. Changing a filter does not add history entries |
| Open finding | `?finding=RULE_ID` opens that finding's detail; closing it removes the parameter |
| Selected request | `/requests/<encoded id>` selects the request; the back button clears it |
| Within a session | A link opens the page only for someone who has the same collection loaded (reload, same tab with session restore, or the team library). It carries ids and filter words, never values, evidence or bodies. An unknown address returns to the dashboard |
| Request tree | Arrow keys move between folders and requests, Right opens a folder, Left closes it or goes to the parent, Home and End jump to the ends |
| Search | `/` or `Ctrl+K` opens request search (`/` is ignored while typing in a field or when a dialog is open); Escape closes any dialog |
| Screen readers | Skip link, labeled icon buttons and progress bars, charts replaced by a text summary, announced analysis progress, one `h1` per page |

## 8. Limitations

- Large collections: pages load on demand, the request tree only draws the rows near the screen, and analysis (including changing rules or the environment) runs in the background, so a collection with thousands of requests opens in about a second. A request body over 64 KB is shown up to its first 64 KB with a notice; findings always use the whole body.
- Detection is heuristic: expect some false positives and false negatives. Tune with Rules.
- PostScope does not check whether a found credential is still valid. Rotate anything it reports.
- Collections larger than 50 MB are refused in the browser; the library stores up to `MAX_COLLECTION_MB` (15 MB default).
- Multi-collection workspaces are not analyzed as one unit (one collection per import; the CLI scans several files separately).
- Environment and globals files are used for URL resolution and secret detection only; variable precedence is simplified to environment, then collection, then globals.

## Glossary

| Term | Meaning |
|---|---|
| Finding | One rule's result: severity, category, affected requests, masked evidence, recommendation |
| Evidence | Where a finding was observed (e.g. `header Authorization`) with a masked preview |
| Rule policy | Disabled rules and severity overrides applied to an audit |
| Auth inheritance | Postman requests without auth use their folder's or the collection's auth; PostScope follows the same chain |
| Sanitized copy | Collection export with credentials replaced by variables |
| Team library | Server-side collection history (hybrid/on modes) |
