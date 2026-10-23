# PostScope

**PostScope** is a client-side web app that analyzes exported **Postman collections** (JSON). It surfaces structure, auth patterns, and **security and hygiene findings** so teams can catch hardcoded secrets and inconsistent practices before APIs hit production.

---

## Overview

API collections often accumulate hardcoded tokens, literal base URLs, and weak documentation. Reviewing them manually is slow and error-prone.

PostScope **parses a collection in the browser**, analyzes it in a Web Worker with a rule-based audit, and presents:

- A **dashboard overview** (metrics, charts, request tree)
- A **requests** explorer with masked secrets and per-request findings
- **Security** and **Hygiene** views with severities, evidence and recommendations
- A **repair center** that proposes fixes and produces a sanitized copy of the collection
- A **score** view with grade and category breakdowns (secrets, variables, auth, hygiene)
- Exports as JSON, SARIF and Markdown, and a **CLI** (`npm run scan`) for CI

Collection analysis never leaves the browser. An optional Node server hosts the built app and can keep a shared **team library** of past collections (see [Deployment](#deployment)). The last imported collection is restored from **session storage** after a refresh (same tab, about 4.5 MB limit).

### Limitations (by design)

- **Rule-based auditor**: findings are heuristic; expect false positives and false negatives. Review recommendations before acting.
- **Static analysis only**: PostScope reads the export. It never calls the APIs in the collection.
- **Postman environments and globals** can be loaded with a collection. They are not stored in the team library (the library keeps collections only).
- **Large collections**: analysis runs in a Web Worker, but very large files can still be slow on low-end devices.

---

## Tech stack

| Area | Choice |
|------|--------|
| Runtime / UI | React 18, React Router 7 |
| Language | TypeScript |
| Build / dev server | Vite 6 |
| Styling | Tailwind CSS 4 (CSS-first `@theme` in `src/index.css`, `@tailwindcss/vite`), tw-animate-css |
| Components | Radix UI primitives, shadcn-style UI (`src/components/ui`) |
| Charts and motion | Recharts, framer-motion |
| Icons | Phosphor Icons (`@phosphor-icons/react`) |
| Analysis | Pure TypeScript engine in `src/lib`, run in a Web Worker |
| Server | Node.js `>=20.6` HTTP server (`server/`), no web framework |
| CLI | `cli/postscope.ts`: run through `tsx` in development, compiled with esbuild to `dist-node/cli.js` (plain `node`) for CI and Docker |
| Tests | `node:test` through `tsx` |
| Utilities | `clsx`, `tailwind-merge`, `class-variance-authority` |

Path alias: `@/` → `src/` (see `vite.config.ts`).

### UI and docs

- [docs/VISUAL_STYLE.md](docs/VISUAL_STYLE.md): voice, punctuation, colors, typography, and layout personality
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): component patterns and Tailwind conventions
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/CI.md](docs/CI.md): architecture, threat model, operations and CI integration (GitHub Action, GitLab, Azure DevOps, pre-commit)
- [docs/schemas/postscope-report.v2.schema.json](docs/schemas/postscope-report.v2.schema.json): JSON Schema of the JSON report
- [docs/mindmap/](docs/mindmap): functional and technical mindmaps (the source of truth for how the code is organized)
- [mindmap/ROADMAP.md](mindmap/ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md): planned and shipped releases

---

## Features

- **Import by drag-and-drop, file picker or pasted JSON**: accepts `.json` and typical `*.postman_collection.json` exports, plus optional `*.postman_environment.json` and `*.postman_globals.json` files
- **Environments and globals**: checked for secrets, used to resolve `{{baseUrl}}` for transport checks, with an environment selector and a sanitized export
- **Collection parsing**: folders, HTTP methods, URLs, headers, bodies, auth inheritance, scripts, saved responses, GraphQL and other request protocols, `{{variable}}` usage vs. defined collection variables
- **Automated audit** with 33 rules, severities (critical / warning / info), categories (secrets, variables, auth, hygiene) and 32 provider secret patterns
- **Overview**: stat cards, method and auth distribution charts, request tree with search
- **Requests, Security and Hygiene**: filterable findings with masked evidence and per-request context
- **Repair**: guided fixes (secrets to variables, base URL variables, auth cleanup and more) and a sanitized download
- **Score**: headline score (85% security, 15% hygiene), letter grade, per-category subscores and a per-finding penalty breakdown; a finding costs more when it affects more requests, and teams can set `SCORE_WEIGHTS`
- **Rule settings**: disable rules or override severities per browser, or set team defaults on the server
- **Exports**: JSON (versioned, with a published schema), SARIF 2.1.0 with line and column locations, Markdown, and a self-contained HTML report
- **Performance**: pages load on demand (the landing page ships about 120 KB of gzipped JavaScript, the analyzer about 250 KB, Recharts only with the Dashboard), the request tree is virtualized above 300 rows, analysis and re-audits run in a Web Worker, and CI enforces size and speed budgets (`npm run bench`)
- **Deep links and keyboard use**: every page, filter, open finding and selected request has its own address (`/analyze/security?severity=critical&rule=HARDCODED_TOKEN`, `/analyze/requests/<id>`), so links and the back button work within a session; arrow-key navigation in the request tree, `/` or `Ctrl+K` to search, and a checked accessibility baseline (axe: no serious violations)
- **Compare versions**: new, resolved and unchanged findings, the score change and added, removed or edited requests between two versions of a collection (two files, or the open collection and a library entry), also as `postscope diff old.json new.json` for pull request checks
- **Team library** (server): shared history with quotas, retention and optional server-side redaction
- **CLI**: `npm run scan` with `--fail-on`, `--min-score` and `--sanitize` for CI, a project config file (`.postscope.json`), baselines so CI fails only on new findings, and reviewed suppressions with a mandatory reason

---

## Screenshots

Screenshots are not checked in yet. After running the app locally, capture these views and add them under `docs/screenshots/`:

| File | View |
|------|------|
| `docs/screenshots/01-drop-zone.png` | Landing import zone |
| `docs/screenshots/02-overview.png` | Overview dashboard |
| `docs/screenshots/03-security.png` | Security findings |
| `docs/screenshots/04-score.png` | Score gauge |

---

## Installation

**Prerequisites**

- [Node.js](https://nodejs.org/) 20.6 or newer (LTS recommended)
- npm (bundled with Node) or another compatible package manager

**Steps**

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd Postscope-App
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server (see [Scripts](#scripts)).

---

## Environment variables

None are required for local development or a static production build. The Node server reads optional settings (logging mode, landing page, hardening, audit policy) documented in [`.env.example`](.env.example), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/SECURITY.md](docs/SECURITY.md).

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server on **port 3010** with hot reload |
| `npm run build` | Typecheck the app and server, then produce the production bundle in `dist/` |
| `npm run typecheck` | Typecheck the app (`tsconfig.json`) and the server (`tsconfig.server.json`) |
| `npm run start` | Run the Node server from source (serves `dist/` and the `/api` endpoints) |
| `npm run build:node` | Compile the server and CLI to `dist-node/` (plain JavaScript, no dependencies at run time) |
| `npm run start:node` | Run the compiled server |
| `npm run preview` | Serve the production build locally on **port 3010** |
| `npm test` | Run every `tests/*.test.ts` suite with the Node test runner |
| `npm run lint` | ESLint (typescript-eslint, react-hooks, jsx-a11y) with zero warnings allowed |
| `npm run format` / `npm run format:check` | Write or check Prettier formatting (no semicolons, single quotes, 140 columns) |
| `npm run check:style` | Fail when the em dash character appears anywhere in the project (docs/VISUAL_STYLE.md) |
| `npm run test:visual` | Screenshot comparison of every page and dialog in both themes against snapshots taken on another commit (for styling changes; snapshots are not committed, see `playwright.visual.config.ts`) |
| `npm run test:e2e` | Browser smoke, navigation, accessibility (axe) and large-collection tests with Playwright against the compiled server; run `npm run build && npm run build:node` first and `npx playwright install chromium` once (or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an installed Chromium) |
| `npm run scan -- <collection.json>` | Audit a collection from the command line (see `--help`; formats text, json, sarif, markdown, html); supports folders and globs, `postscope diff <old> <new>` to compare two versions, `--format junit`, `--auto-env`, `--environment`, `--globals`, `--weights`, `--min-score`, `--config`, `--baseline` and `--write-baseline` |
| `npm run bench` | Parse and audit time on a 6000-request collection plus bundle sizes; `-- --check` fails when a number is more than 20 percent worse than `scripts/bench-baseline.json`, `-- --update` records a new baseline, `-- --report file` writes JSON |
| `npm run audit:deps` | Audit runtime dependencies for known vulnerabilities |
| `npm run release:check` | Verify that package, Docker and compose versions match the changelog |

---

## Project structure

```
Postscope-App/
├── index.html              # HTML shell, app title, font preconnect
├── vite.config.ts          # Vite + React plugin, @ alias
├── playwright.config.ts    # browser tests (e2e/), playwright.visual.config.ts for screenshot comparison (visual/)
├── eslint.config.js, .prettierrc.json
├── Dockerfile, compose.yaml
├── cli/                    # postscope.ts (CLI entry) and inputs.ts (folders, globs, sibling environments)
├── action.yml              # GitHub composite action
├── server/                 # Node server: static hosting, /api, team library, hardening
├── scripts/                # Test runner, release check, node build, demo collection generator
├── tests/                  # node:test suites and fixtures
├── docs/                   # Architecture, security, deployment, style guides, mindmaps
├── mindmap/ROADMAP.md      # Release plan
├── CHANGELOG.md
├── src/
│   ├── main.tsx            # React root, router, global providers
│   ├── App.tsx             # Routes: landing, analyzer, samples
│   ├── index.css           # Global styles / design tokens
│   ├── types/postman.ts    # Postman collection JSON shapes
│   ├── lib/                # parser, auditor, rules, secretPatterns, scorer, repairEngine,
│   │                       # redaction, reportExport and other engine modules
│   ├── workers/            # analysis.worker.ts (parse, audit and score off the main thread)
│   ├── pages/              # AnalyzeApp, Overview, Requests, Security, Hygiene, Repair, Score
│   └── components/         # DropZone, RequestTree, modals, badges, layout/, charts/, ui/
└── dist/                   # Production output (after build; gitignored)
```

**Flow:** `AnalyzeApp` sends the file to the analysis worker → `parseCollection` → `runAudit` → `calculateScore`. Pages consume `ParsedCollection`, `Finding[]`, and `ScoreBreakdown`.

---

## Usage

1. Run `npm run dev` and open `http://localhost:3010`.
2. Export a collection from Postman (**Collection → … → Export**) as Collection v2.1 JSON.
3. Drop the file on the landing zone or use **Browse**.
4. On success, use the sidebar:
   - **Overview**: inventory and charts  
   - **Security**: findings by severity  
   - **Score**: grade and category breakdown  
5. Use the header **search** to filter content where supported.
6. Use **Analyze another** to clear state and import a new file.

Refreshing the page keeps the current collection in this browser tab (session storage). Closing the tab clears it.

If parsing fails, confirm the file is valid JSON and a Postman collection (schema in `info.schema` is expected for real exports).

---

## Deployment

For internal and offline deployments, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

PostScope can run from source with `npm run build && npm run start`, or as a single Docker image. The Docker path includes the production web bundle, the app server, and runtime dependencies so the image can be pulled or loaded and then run without internet access.

Key runtime settings:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3010` | App server port |
| `APP_VERSION` | package version | Release/build identifier exposed by `/api/config` |
| `LOGGING_MODE` | `off` | `off`, `hybrid`, or `on` collection storage behavior |
| `PUBLIC_LANDING_PAGE` | `false` | Whether `/` shows the public landing page instead of the analyzer |
| `SHOW_GITHUB_LINK` | `true` | Whether the analyzer sidebar shows the GitHub link |
| `SHOW_FEEDBACK_LINK` | `true` | Whether the analyzer sidebar shows the feedback link |
| `FEEDBACK_URL` | GitHub issue form | External feedback form URL opened from the sidebar |

No API keys are required for the stock app.

---

## Contributing

1. Fork the repository and create a feature branch (`feat/…`, `fix/…`).
2. Keep changes focused; match existing TypeScript and component patterns.
3. Run `npm run lint`, `npm run format:check`, `npm run check:style`, `npm test` and `npm run build` locally (CI also runs `npm run test:e2e`, the performance budgets and a Docker smoke test).
4. Open a pull request with a short description of behavior changes and any UI impact.

For audit rules, register the rule in `src/lib/rules.ts`, implement it in `src/lib/auditor.ts` and add positive and false-positive tests. Release rules (one commit per version, changelog, tags) are in [mindmap/ROADMAP.md](mindmap/ROADMAP.md).

---

## Roadmap and changelog

- [mindmap/ROADMAP.md](mindmap/ROADMAP.md) lists the planned releases, why they exist and how to implement them.
- [CHANGELOG.md](CHANGELOG.md) lists what shipped in each release.

---

## License

[MIT](LICENSE)
