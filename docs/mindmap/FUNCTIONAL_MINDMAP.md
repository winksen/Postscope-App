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
| Drag and drop / Browse | Accepts `.json` and `*.postman_collection.json`. Empty files and files over 50 MB are refused with a clear message. |
| Paste JSON | Validates that the text is JSON with `info` and an `item` array before importing. |
| Sample collections | Four bundled demos: clean default, large messy enterprise collection, secrets + auth, intentionally vulnerable. |
| Team library | "Recently saved" list on the import page and a full library dialog (open, export, remove). |
| Session restore | In history/on modes the last collection survives a page refresh (same tab, ≈4.5 MB limit). |

Analysis runs in a **background worker**, so the page stays responsive even for very large collections. If a file is only partly readable (malformed folders, broken items), PostScope imports what it can and shows a notice listing what was skipped. Errors appear as dismissible notifications rather than blocking pop-ups.

## 3. Understanding the results

| Page | Purpose |
|---|---|
| **Dashboard** | Request, folder, and variable counts; method and auth distribution charts; collection structure tree. |
| **Requests** | Postman-like explorer: folder tree, request details (URL, query params, headers, body), and per-request findings with a health score. Credential values are **masked** until the user clicks the eye icon. |
| **Security** | All security-impact findings with severity/category filters and search. The detail dialog shows the recommendation, affected requests, **masked evidence** (where each issue was found), and **CWE / OWASP API Top 10** references. |
| **Hygiene** | Maintainability notes: missing descriptions, duplicate or placeholder names, loose root requests, deep nesting, empty headers, GET requests with bodies. |
| **Score** | 0–100 score, letter grade (A–F), per-category scores (Secrets, Variables, Auth, Hygiene), and improvement advice. |

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
| Critical | Hardcoded secret in script | `pm.environment.set("token", "abc…")` |
| Critical | Secret stored in collection variable | `clientSecret = cs-0a1b…` exported with the collection, or defined on a folder or request |
| Critical | Secret in saved example response | Captured `access_token` or `Set-Cookie` in an example, or a password in the example's original request body |
| Critical | Secret pasted into documentation | `password: …` or `Authorization: Bearer …` in a collection, folder or request description |
| Critical | Provider token detected | AWS, GitHub, Slack, Stripe, Google, OpenAI, Anthropic, JWT, private keys, … |
| Warning | Hardcoded base URL / environment URL | `https://api.prod.example.com/…` instead of `{{baseUrl}}` |
| Warning | Potentially unprotected mutation request | `POST` without auth (inherited auth is respected) |
| Warning | Basic auth with literal credentials | Username/password typed into Basic auth |
| Warning | Plaintext HTTP endpoint | `http://` to a non-local host, including via `{{baseUrl}}` |
| Warning | TLS certificate verification disabled | `strictSSL: false` |
| Warning | Sensitive value logged by script | `console.log(pm.environment.get("token"))` |
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
| Medium | Yes (descriptions: no) | Replace base URLs with `{{baseUrl}}`, move tokens, passwords, query secrets, and auth-helper secrets to variables, clear secret collection variables |
| Medium | No | Re-enable TLS verification |
| High | No | Upgrade `http://` endpoints to `https://` |
| Manual | n/a | Scripts, saved responses, credentials in URLs, provider tokens, naming and structure |

After applying, PostScope re-analyzes the repaired collection, shows the real score change, and lets the user export the repaired JSON or reset to the original.

### Rule settings

The sliders icon in the header opens **Rules**: turn any rule off or change its severity. Changes re-run the audit instantly and are remembered in the browser. Operators can ship **team defaults** (`AUDIT_DISABLED_RULES`, `AUDIT_SEVERITY_OVERRIDES`); "Reset to defaults" returns to them.

### Export

The download icon in the header offers:

| Export | Use |
|---|---|
| Markdown report | Pull requests, tickets, audit evidence |
| JSON report | Dashboards and custom tooling |
| SARIF report | GitHub code scanning, Azure DevOps, other CI security dashboards |
| Sanitized copy | A runnable collection with every detected credential replaced by `{{variables}}` / `{{REDACTED}}`, safe to share |

Reports never include full secret values, only masked previews.

## 5. Team library

Available in `hybrid` and `on` modes.

- **Consent first (hybrid):** users must accept an upload warning before anything is stored.
- **No duplicates:** saving identical content returns the existing entry ("Already in the team library").
- **Operator policies:** maximum items, retention in days, total size quota, optional server-side **secret redaction** before storing, and an option to **disable removal** for audit trails.
- **Library dialog:** open, export JSON, or remove (when allowed). Load errors show a retry button instead of failing silently.

## 6. CI automation (CLI)

`npm run scan -- <collection.json …>` runs the exact same audit outside the browser.

| Flag | Effect |
|---|---|
| `--format text|json|sarif|markdown` | Report format (multiple files merge into one JSON array or one SARIF log) |
| `--fail-on critical|warning|info|none` | Exit code 1 when findings at or above this severity exist (default: critical) |
| `--min-score N` | Exit code 1 when a collection scores below N |
| `--disable`, `--severity` | Same rule policy controls as the UI |
| `--sanitize out.json` | Write a sanitized copy |
| `--list-rules` | Print the rule catalog |
| `--version` | Print the PostScope version (same value as the app, Docker image and `/api/config`, from any directory) |

Exit codes: `0` pass, `1` policy failure, `2` usage or input error.

## 7. Privacy and security guarantees (user view)

- In `off` mode (default) collections never leave the browser.
- Credentials are masked on screen until revealed; reports and the CLI only show masked previews.
- Optional sign-in gate (HTTP Basic auth) for internal deployments, with lockout after repeated failures.
- The server rejects cross-site requests, oversized uploads, malformed IDs, and path tricks; it applies a strict Content Security Policy.

Full details: [../SECURITY.md](../SECURITY.md).

## 8. Limitations

- Detection is heuristic: expect some false positives and false negatives. Tune with Rules.
- PostScope does not check whether a found credential is still valid. Rotate anything it reports.
- Collections larger than 50 MB are refused in the browser; the library stores up to `MAX_COLLECTION_MB` (15 MB default).
- Postman environments, globals, and multi-file workspaces are not analyzed (only collection exports).

## Glossary

| Term | Meaning |
|---|---|
| Finding | One rule's result: severity, category, affected requests, masked evidence, recommendation |
| Evidence | Where a finding was observed (e.g. `header Authorization`) with a masked preview |
| Rule policy | Disabled rules and severity overrides applied to an audit |
| Auth inheritance | Postman requests without auth use their folder's or the collection's auth; PostScope follows the same chain |
| Sanitized copy | Collection export with credentials replaced by variables |
| Team library | Server-side collection history (hybrid/on modes) |
