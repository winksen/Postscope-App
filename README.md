# PostScope

**PostScope** is a client-side web app that analyzes exported **Postman collections** (JSON). It surfaces structure, auth patterns, and **security and hygiene findings** so teams can catch hardcoded secrets and inconsistent practices before APIs hit production.

---

## Overview

API collections often accumulate hardcoded tokens, literal base URLs, and weak documentation. Reviewing them manually is slow and error-prone.

PostScope **parses a collection file locally in the browser**, runs a rule-based audit, and presents:

- A **dashboard overview** (metrics, charts, request tree)
- A **security / findings** view with severities and recommendations
- A **score** view with grade and category breakdowns (secrets, variables, auth, hygiene)

**No server or API keys are required.** Collection analysis runs in the browser; the last imported collection is restored from **session storage** after a refresh (same tab, ~4.5 MB limit). There is no server-side persistence.

### Limitations (by design)

- **Rule-based auditor**: findings are heuristic; expect false positives and false negatives. Review recommendations before acting.
- **No backend**: collections are not uploaded or stored on a server.
- **Large collections**: parsing and audit yield to the browser event loop, but very large files may still feel slow on low-end devices.

---

## Tech stack

| Area | Choice |
|------|--------|
| Runtime / UI | React 18 |
| Language | TypeScript |
| Build / dev server | Vite 6 |
| Styling | Tailwind CSS 3, tailwindcss-animate |
| Components | Radix UI primitives, shadcn-style UI (`src/components/ui`) |
| Charts | Recharts |
| Icons | Lucide React |
| Utilities | `clsx`, `tailwind-merge`, `class-variance-authority` |

Path alias: `@/` → `src/` (see `vite.config.ts`).

### UI and docs

- [docs/VISUAL_STYLE.md](docs/VISUAL_STYLE.md): voice, punctuation, colors, typography, and layout personality
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): component patterns and Tailwind conventions

---

## Features

- **Import by drag-and-drop or file picker**: accepts `.json` and typical `*.postman_collection.json` exports
- **Collection parsing**: folders, HTTP methods, URLs, headers, bodies, auth types, `{{variable}}` usage vs. defined collection variables
- **Automated audit** with severities (critical / warning / info), categories (secrets, variables, auth, hygiene), and actionable recommendations
- **Overview**: stat cards, method and auth distribution charts, collapsible request tree with search
- **Security**: consolidated findings list, filtering, and per-request context where applicable
- **Score**: numeric score, letter grade, per-category subscores, and improvement hints
- **Responsive dashboard**: sidebar navigation, header search, analyze-another flow

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

- [Node.js](https://nodejs.org/) 18+ or 20+ (LTS recommended)
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

None are required for local development or a static production build. The application does not call a backend for collection analysis.

If you add integrations later (e.g. telemetry, remote APIs), document them here with name, purpose, and example values.

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server on **port 3010** with hot reload |
| `npm run build` | Typecheck (`tsc -b`) and produce an optimized production bundle in `dist/` |
| `npm run preview` | Serve the production build locally on **port 3010** |

---

## Project structure

```
Postscope-App/
├── index.html              # HTML shell, app title, font preconnect
├── vite.config.ts          # Vite + React plugin, @ → src alias
├── tailwind.config.ts
├── postcss.config.js
├── package.json
├── src/
│   ├── main.tsx            # React root, global TooltipProvider
│   ├── App.tsx             # Upload flow, parse → audit → score, routing by nav
│   ├── index.css           # Global styles / design tokens
│   ├── types/
│   │   └── postman.ts      # Postman collection JSON shapes
│   ├── lib/
│   │   ├── parser.ts       # JSON → ParsedCollection
│   │   ├── auditor.ts      # Rule engine → Finding[]
│   │   ├── scorer.ts       # Score + grade from findings
│   │   ├── requestFindings.ts
│   │   └── utils.ts
│   ├── pages/
│   │   ├── OverviewPage.tsx
│   │   ├── SecurityPage.tsx
│   │   └── ScorePage.tsx
│   └── components/
│       ├── DropZone.tsx
│       ├── RequestTree.tsx
│       ├── RequestAnalysisModal.tsx
│       ├── StatCard.tsx, ScoreGauge.tsx, MethodBadge.tsx, SeverityBadge.tsx
│       ├── layout/         # dashboard-shell, sidebar, header
│       ├── charts/         # chart tooltips
│       └── ui/             # Buttons, cards, dialogs, tabs, etc.
└── dist/                   # Production output (after build; gitignored)
```

**Flow:** `App.tsx` loads a file → `parseCollection` → `runAudit` → `calculateScore`. Pages consume `ParsedCollection`, `Finding[]`, and `ScoreBreakdown`.

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
| `LOGGING_MODE` | `off` | `off`, `hybrid`, or `on` collection storage behavior |
| `PUBLIC_LANDING_PAGE` | `false` | Whether `/` shows the public landing page instead of the analyzer |

No API keys are required for the stock app.

---

## Contributing

1. Fork the repository and create a feature branch (`feat/…`, `fix/…`).
2. Keep changes focused; match existing TypeScript and component patterns.
3. Run `npm run build` locally to ensure typecheck and production build succeed.
4. Open a pull request with a short description of behavior changes and any UI impact.

For audit rules, extend `src/lib/auditor.ts` and adjust scoring in `src/lib/scorer.ts` if penalties should change.

---

## Future improvements (optional)

- Export findings as JSON or SARIF for CI
- Deeper Postman features (pre-request scripts, tests, multi-file collections)
- Web Worker offload for very large collections
- Custom rule packs or configurable severity weights
- Offline / PWA packaging for air-gapped use
- Internationalization

---

## License

[MIT](LICENSE)
