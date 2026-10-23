# PostScope: Internal Architecture

This document describes how the PostScope application is structured, how data flows through it, and how to extend it safely.

> **Source of truth:** [mindmap/TECHNICAL_MINDMAP.md](mindmap/TECHNICAL_MINDMAP.md) tracks every module, the server, configuration and known limitations release by release. This file is the shorter narrative; when the two disagree, trust the mindmap.

---

## 1. High-level overview

### What the app does

PostScope is a **single-page React application** whose analysis runs entirely in the browser (in a Web Worker). A small Node server hosts the built bundle and an optional team library. Users upload a **Postman Collection v2.x JSON** export. The app:

1. **Parses** the file into a normalized in-memory model (`ParsedCollection`).
2. **Audits** that model with deterministic rules and produces a list of **findings** (security, variables, auth, hygiene).
3. **Scores** the collection from those findings and presents **Overview**, **Security**, **Hygiene**, and **Score** views.

No network calls are required for core functionality; collection data is only sent to the server when a user explicitly saves it to the team library.

### Core business logic

| Concern | Module | Responsibility |
|--------|--------|----------------|
| Parse Postman JSON → domain model | `src/lib/parser.ts` | Walk `item[]` tree, flatten requests, aggregate methods/auth/variables/folders |
| Rule engine | `src/lib/auditor.ts` | Critical / warning / info checks; each rule emits `Finding` objects |
| Scoring | `src/lib/scorer.ts` | Scoring model v2: weighted, request-scaled penalties; separate security and hygiene scores, headline grade and per-finding breakdown |
| Per-request rollups | `src/lib/requestFindings.ts` | Map findings to requests by stable id; per-request health score |

The **UI layer** (`App.tsx`, pages, components) is largely presentational: it renders parsed data and findings passed as props.

---

## 2. Architecture

### 2.1 Frontend structure

| Layer | Location | Role |
|-------|----------|------|
| Bootstrap | `src/main.tsx` | `createRoot`, global styles, `TooltipProvider` |
| App shell / orchestration | `src/App.tsx`, `src/pages/AnalyzeApp.tsx` | Routes, file ingest, worker pipeline (parse/audit/score), “which page” selection |
| Pages | `src/pages/*.tsx` | Full-width views: Overview, Requests, Security, Hygiene, Repair, Score |
| Feature components | `src/components/*.tsx` | Drop zone, request tree, modals, badges, charts |
| Layout | `src/components/layout/` | `DashboardShell`, `AppSidebar`, `AppHeader` |
| Design system | `src/components/ui/` | Radix-based primitives (buttons, dialogs, tables, …) |
| Domain types | `src/types/postman.ts` | TypeScript shapes for raw Postman JSON |

**Routing:** React Router handles the top-level routes (landing page, `/analyze`, samples). Inside the analyzer, dashboard navigation is an in-memory **string union** `NavId` held by `AnalyzeApp` and toggled from the sidebar, so pages cannot be deep-linked yet. Security-impact findings and hygiene findings are split into separate pages, but scoring and repair still receive the full finding list.

### 2.2 Backend

A dependency-light Node HTTP server (`server/`) serves the built bundle, `/api/config`, `/api/health` and the optional team library (`/api/collections`). It adds security headers, rate limits, optional Basic auth and atomic file storage. Analysis itself never needs the server. See the technical mindmap section 4 and [DEPLOYMENT.md](DEPLOYMENT.md).

### 2.3 Data flow

```mermaid
flowchart LR
  subgraph input [Input]
    F[Postman JSON file]
  end
  subgraph core [Core]
    P[parser.parseCollection]
    A[auditor.runAudit]
    S[scorer.calculateScore]
  end
  subgraph ui [UI]
    D[DropZone]
    DS[DashboardShell]
    OV[OverviewPage]
    SEC[SecurityPage]
    HYG[HygienePage]
    SC[ScorePage]
  end
  F --> D
  D -->|FileReader + JSON.parse| P
  P --> A
  P --> S
  A --> S
  P --> DS
  A --> DS
  S --> DS
  DS --> OV
  DS --> SEC
  DS --> SC
```

1. **Landing:** `App` renders `DropZone` until `parsed` is non-null.
2. **Import:** User drops, selects or pastes JSON → `AnalyzeApp` posts the text to `analysis.worker.ts` → `JSON.parse` → `parseCollection` → `runAudit` → a compact copy of the result (bodies over 64 KB cut for display) → `calculateScore` → state is set from the worker result. The worker keeps the full parsed collection, so a rule or environment change sends only a small `audit` message.
3. **Dashboard:** `calculateScore(parsed, findings)` is derived on each render (cheap; memoization optional).
4. **Child views** receive `parsed`, `findings`, `score` (where needed), and `search` from `App`.

`search` lives in `App` and is wired through `AppHeader` and into `OverviewPage` / `SecurityPage` for consistent filtering.

---

## 3. Key features

### 3.1 Collection import (drop zone)

| | Purpose | How it works | Main files |
|---|--------|--------------|------------|
| Import | Accept Postman export | Drag-and-drop or file input; validates extension; `FileReader.readAsText` → parse | `DropZone.tsx`, `App.tsx` |

Errors surface as toasts and inline messages.

### 3.2 Overview

| | Purpose | How it works | Main files |
|---|--------|--------------|------------|
| Overview | Inventory + visuals | Stat cards; Recharts bar/pie for methods and auth; collapsible **request tree** with global search | `OverviewPage.tsx`, `StatCard.tsx`, `RequestTree.tsx`, `RequestAnalysisModal.tsx` |

The tree builds a folder hierarchy from `ParsedRequest.folderPath`, filters by search, and opens `RequestAnalysisModal` for drill-down.

### 3.3 Security findings

| | Purpose | How it works | Main files |
|---|--------|--------------|------------|
| Security | Review security-impact audit results | Local state for severity/category filters + dialog detail; excludes `hygiene`; merges header `search` with `findingMatchesQuery` | `SecurityPage.tsx`, `SeverityBadge.tsx` |
| Hygiene | Review maintainability notes | Local state for severity filter + dialog detail; shows only `hygiene` findings such as missing descriptions | `HygienePage.tsx`, `SeverityBadge.tsx` |

Pages render immediately; heavy lists are bounded by the analysis result size.

### 3.4 Score

| | Purpose | How it works | Main files |
|---|--------|--------------|------------|
| Score | Executive posture | `ScoreGauge`, category progress bars, tabbed or static advice derived from finding categories | `ScorePage.tsx`, `ScoreGauge.tsx`, `scorer.ts` |

### 3.5 Request-level analysis modal

| | Purpose | How it works | Main files |
|---|--------|--------------|------------|
| Drill-down | Tie findings to one request | `findingsForRequest` filters by stable `request.id`; labels via `findingDisplay.ts`; `requestHealthScore` reuses the penalty function from `severity.ts` | `RequestAnalysisModal.tsx`, `requestFindings.ts` |

---

## 4. Component structure

### 4.1 Reusable / feature components

- **`DropZone`:** Landing card; drag state; delegates file to `onFile`.
- **`RequestTree`:** Folder tree + rows; search filter; integrates modal.
- **`RequestAnalysisModal`:** Radix `Dialog` showing request metadata and related findings.
- **`StatCard`:** Metric tiles on overview.
- **`ScoreGauge`:** Visual total score.
- **`MethodBadge` / `SeverityBadge`:** Consistent method and severity chips.
- **`ChartTooltipFrame`:** Shared tooltip wrapper for Recharts.

### 4.2 Layout system

- **`DashboardShell`:** Owns **sidebar collapse** local state (`collapsed`), computes width, positions fixed sidebar + header + padded `main`.
- **`AppSidebar`:** Nav buttons; exports `NavId`; shows separate count badges for Security, Hygiene, and Repair.
- **`AppHeader`:** Global search, collection name display, “analyze another” and decorative controls.

Layout uses **fixed** sidebar/header with `padding-left` / `left` offset derived from collapse width. No CSS-grid app shell abstraction yet.

### 4.3 Patterns

- **Composition:** Pages receive data via props; no page-level data fetching.
- **Hooks:** `useState`, `useCallback`, `useMemo`, `useEffect` used locally; no custom global hooks.
- **Services:** Pure functions in `src/lib/`. Easy to unit test; no DI container.
- **UI library:** “shadcn-style”: copy-paste Radix wrappers in `ui/` with Tailwind + `cva` variants.
- **Aliasing:** `@/` → `src/` (Vite `resolve.alias`).

---

## 5. State management

| State | Owner | Notes |
|-------|--------|------|
| `parsed`, `findings`, `rawJson`, `originalRawJson` | `AnalyzeApp` | Null parsed ⇒ import screen; non-null ⇒ dashboard. The original JSON is kept for repair reset |
| `userAuditPrefs` | `AnalyzeApp` | Browser rule policy over the server policy; changes re-run the audit without re-parsing |
| `active: NavId` | `AnalyzeApp` | Which main page is visible |
| `search: string` | `AnalyzeApp` | Shared header search |
| Library, storage mode, consent | `AnalyzeApp` | Team library list and the incognito/shared choice |
| Sidebar `collapsed` | `DashboardShell` | Pure UI preference |
| Security / Hygiene filters, detail dialog | Each page | Local only |

**No React Context** for domain data. **`TooltipProvider`** wraps the app in `main.tsx` for Radix tooltips. The complete state table is in the technical mindmap section 3.2.

Derived data: `score` is memoized from `parsed` and `findings` inside `AnalyzeApp`.

---

## 6. API / integrations

| Kind | Detail |
|------|--------|
| External HTTP APIs | **None**. PostScope never calls the APIs in a collection |
| PostScope server API | `fetch` calls to the same origin only: `/api/config`, `/api/health`, `/api/collections` (team library) |
| Browser APIs | `File.text()`, `JSON.parse`, Web Worker, `sessionStorage` / `localStorage` through safe wrappers |
| Third-party scripts | None required for the stock offline build; Elms Sans font files are served locally from `public/fonts` |
| npm libraries | React, React Router, Vite, Radix, Recharts, framer-motion, Phosphor Icons, Tailwind utilities |

---

## 7. Design decisions

1. **Client-side processing:** Analysis never needs a server, which avoids sending secrets anywhere. The optional Node server only hosts the bundle and the team library. Trade-off: large collections only scale to browser memory/CPU limits.

2. **Pure-function pipeline (parse → audit → score):** Predictable, test-friendly, and easy to reason about. The pipeline runs in a Web Worker, so large files do not freeze the UI. Trade-off: no incremental parsing.

3. **Findings keyed by stable request `id`:** Parser assigns folder-path ids and disambiguates duplicate names in the same folder (`#2`, `#3`, …). `findingDisplay.ts` maps ids to human-readable paths in the UI.

4. **In-memory navigation inside the analyzer:** Few views; state resets on full reload, but the last collection is restored from session storage. Trade-off: cannot deep-link to a page (planned in the roadmap).

5. **Rule-based auditor vs. ML:** Deterministic rules give explainable results for compliance-minded users. Trade-off: false positives/negatives depend on rule quality only.

6. **One set of weights:** `severity.ts` holds the weights and penalty functions used by both the global scorer and the per-request health score; deployments can override the weights (`SCORE_WEIGHTS`).

---

## 8. Known limitations

- **Heuristic rules** can produce false positives/negatives; treat output as guidance, not proof.
- **Audit coverage** is heuristic (regex, JSON body shape); non-JSON bodies and edge-case Postman features may be missed.
- **`BASIC_AUTH_PLAINTEXT`** fires when Postman basic auth uses literal `username` / `password` fields (not `{{variables}}`).
- **Session-only restore:** a refresh keeps the collection in the tab, closing it clears the session. Reports can be exported as Markdown, JSON and SARIF.
- **Scoring model** is a weighted, capped penalty sum (see the technical mindmap section 2.4); it may not match every team's risk model, which is why the weights are configurable.
- The full and current list is in the technical mindmap section 9, and the planned fixes are in [../mindmap/ROADMAP.md](../mindmap/ROADMAP.md).

---

## 9. How to extend the app

### 9.1 Add a new audit rule

1. Open `src/lib/auditor.ts`.
2. Add the check to the rule engine and emit it through the shared finding helpers.
3. Push a `Finding` with stable *meaning* for `category` and `severity`.
4. Register the rule in `src/lib/rules.ts` (title, category, severity, CWE) and add tests in `tests/auditor.test.ts`. If scoring should change, adjust the weights or caps in `src/lib/severity.ts`.

### 9.2 Add a new top-level page

1. Extend `NavId` in `app-sidebar.tsx` and add a nav item.
2. Create `src/pages/NewPage.tsx`.
3. In `App.tsx`, render `NewPage` when `active === '…'` and pass required props (`parsed`, `findings`, `score`, `search`).

### 9.3 Add dashboard widgets

- Prefer `OverviewPage.tsx` or `ScorePage.tsx` for analytics widgets.
- Reuse `src/components/ui/card.tsx` and existing chart patterns from `OverviewPage`.

### 9.4 Add server behavior

Server code lives in `server/` and shares `src/lib` (redaction, rule policy) with the browser bundle. Keep `parser` / `auditor` free of browser APIs so they stay usable in Node and in the CLI.

### 9.5 Add routes

Top-level routes live in `App.tsx` (React Router). Dashboard pages are still `NavId` state; moving them into routes is planned for V0.1.42.

---

## Document maintenance

Update this file when:

- Adding or removing **major modules** under `src/lib/`.
- Changing **navigation** or **global state** ownership.
- Introducing **network** behavior or **build/deploy** assumptions.

Last aligned with release V0.1.25. The technical mindmap is updated with every release.
