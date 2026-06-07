# PostScope: Cursor Initialization Prompt

> Copy this entire prompt into Cursor's composer (Agent mode). It will scaffold, install, and run the app.

---

## Project Brief

Build a local React + Vite app called **PostScope**: a Postman collection analyzer and security auditor. The user drops a `.postman_collection.json` export file, and the app parses it entirely in the browser (no backend, no uploads, fully offline) and produces:

1. A structured **Collection Overview** (folders, requests, auth methods, HTTP methods distribution)
2. A **Security Audit** with severity-rated findings
3. A calculated **Health Score** (0–100) with a visual score gauge

---

## Tech Stack

- **React 18** + **Vite**
- **TypeScript**
- **Tailwind CSS v3** (with custom config)
- **Recharts** (for charts and the score gauge)
- **Lucide React** (icons only: no icon libraries that ship heavy CSS)
- **clsx** for conditional classes
- No backend. No API calls. Everything runs in the browser.

---

## Design System & Visual Identity

### Philosophy
"Surgical minimalism meets developer precision." Every pixel has a reason. No shadows for decoration. No gradients for drama. Depth comes from spacing, weight contrast, and selective use of the accent color.

### Color Rationale
Postman's brand color is **#FF6C37** (Burning Orange, HSL 16°).  
Its color-wheel complement (hue + 180° = 196°) is a **cool azure-cyan**.  
PostScope's accent color IS that complement: it signals that this tool *completes* Postman's workflow.

### Color Tokens (implement as CSS custom properties on `:root`)

```css
:root {
  /* Backgrounds */
  --bg-base:        #0A0E14;   /* Deep carbon: almost black with a blue undertone */
  --bg-surface:     #0F1520;   /* Cards, panels */
  --bg-elevated:    #162030;   /* Hover states, selected items */
  --bg-border:      #1E2D42;   /* Dividers, card borders */

  /* Primary accent: PostScope Cyan (complement of Postman Orange) */
  --accent:         #2EB8E6;   /* HSL 196°: pure complement of #FF6C37 */
  --accent-dim:     #1A6E8A;   /* Muted accent for subtle use */
  --accent-glow:    rgba(46, 184, 230, 0.12); /* Glow/halo effects */

  /* Semantic colors */
  --critical:       #F03E3E;   /* Critical severity */
  --critical-dim:   rgba(240, 62, 62, 0.12);
  --warning:        #F59F00;   /* Medium severity */
  --warning-dim:    rgba(245, 159, 0, 0.12);
  --info:           #2EB8E6;   /* Info / low severity (reuse accent) */
  --info-dim:       rgba(46, 184, 230, 0.12);
  --success:        #37B24D;   /* Passing checks */
  --success-dim:    rgba(55, 178, 77, 0.12);

  /* Postman reference color (used sparingly for visual callouts) */
  --postman-orange: #FF6C37;

  /* Typography */
  --text-primary:   #E8EEF4;
  --text-secondary: #7A93AE;
  --text-muted:     #3D5570;
  --text-code:      #2EB8E6;

  /* Misc */
  --radius-sm:      4px;
  --radius-md:      8px;
  --radius-lg:      12px;
  --font-mono:      'JetBrains Mono', 'Fira Code', monospace;
  --font-sans:      'DM Sans', system-ui, sans-serif;
}
```

### Typography

Import from Google Fonts in `index.html`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

- **Body / UI text**: DM Sans: clean, modern, slightly geometric. Not Inter (too generic).
- **Code paths, method badges, variable names**: JetBrains Mono: gives technical credibility
- **Scale**: 11px (label), 13px (body-sm), 15px (body), 18px (subtitle), 24px (title), 36px+ (display/score)

### Spacing & Grid

Use an 8px base grid. Sections have `padding: 32px`. Cards have `padding: 20px`. Inner elements gap: `12px` or `16px`. 

### Visual References to Emulate

The design should feel like a **intersection of**:
- **Linear.app**: dark background, razor-sharp typography, no wasted space
- **GitHub's dark theme**: monospaced type for code, card-based content with subtle borders
- **Raycast's docs**: clean structure with colored severity badges
- **Vercel dashboard**: numerical data presented with confidence, large score numbers

### What NOT to do

- No purple gradients
- No glassmorphism blur effects
- No heavy shadows
- No rainbow color usage
- No rounded hero cards that look like SaaS marketing
- No skeleton loaders with pulse animations on a static tool
- No emoji in UI copy

---

## App Architecture

### File Structure

```
postscope/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css              # CSS variables + global resets
│   ├── types/
│   │   └── postman.ts         # TypeScript types for collection JSON
│   ├── lib/
│   │   ├── parser.ts          # Parses raw JSON → structured data
│   │   ├── auditor.ts         # Security rules engine → findings[]
│   │   └── scorer.ts          # Score calculation from findings + stats
│   ├── components/
│   │   ├── DropZone.tsx       # File drop + upload UI
│   │   ├── Header.tsx         # App header with branding
│   │   ├── ScoreGauge.tsx     # Radial score visualization
│   │   ├── StatCard.tsx       # Reusable metric card
│   │   ├── FindingRow.tsx     # Single security finding
│   │   ├── MethodBadge.tsx    # GET / POST / PUT colored badge
│   │   ├── SeverityBadge.tsx  # CRITICAL / WARNING / INFO badge
│   │   ├── TabNav.tsx         # Overview / Security / Score tabs
│   │   └── RequestTree.tsx    # Collapsible folder/request tree
│   └── pages/
│       ├── OverviewPage.tsx
│       ├── SecurityPage.tsx
│       └── ScorePage.tsx
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

---

## Core Logic

### 1. `types/postman.ts`

Define TypeScript interfaces matching Postman Collection v2.1 JSON format:
- `PostmanCollection`, `PostmanFolder`, `PostmanRequest`, `PostmanItem`, `PostmanAuth`, `PostmanHeader`, `PostmanBody`, `PostmanVariable`

### 2. `lib/parser.ts`: Collection Parser

Parse the raw JSON and extract:

```typescript
interface ParsedCollection {
  name: string;
  version: string;                    // "2.1" or "2.0"
  totalRequests: number;
  totalFolders: number;
  methods: Record<string, number>;    // { GET: 12, POST: 5, ... }
  authTypes: Record<string, number>;  // { bearer: 8, basic: 2, noauth: 3 }
  variables: string[];                // all {{variable}} references found
  definedVariables: string[];         // vars defined in collection-level vars
  requests: ParsedRequest[];
  folders: ParsedFolder[];
}

interface ParsedRequest {
  id: string;
  name: string;
  method: string;
  url: string;                        // raw URL string
  folderPath: string[];               // breadcrumb
  auth: string;                       // auth type or 'noauth'
  headers: Array<{ key: string; value: string }>;
  bodyRaw?: string;
  hasDescription: boolean;
}
```

Recursively walk `item[]` arrays (folders can be nested). Extract all `{{variable}}` patterns from URLs, headers, and body with regex `/{{\w+}}/g`.

### 3. `lib/auditor.ts`: Security Rules Engine

Run these checks and return `Finding[]`:

```typescript
interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'secrets' | 'variables' | 'auth' | 'hygiene';
  title: string;
  description: string;
  affected: string[];   // list of request names or field paths
  recommendation: string;
}
```

**Rules to implement:**

**🔴 CRITICAL: Hardcoded Secrets**
- `HARDCODED_PASSWORD`: Header or body key matches `/passw|password|passwd/i` AND value is NOT `{{...}}` pattern AND value is not empty
- `HARDCODED_TOKEN`: Header `Authorization` value is NOT `{{...}}` AND not empty AND matches `Bearer .+` or `Basic .+` with an actual value
- `HARDCODED_API_KEY`: Header key matches `/api.?key|x-api-key|apikey/i` AND value not variabilized
- `HARDCODED_SECRET`: Body JSON contains keys matching `/secret|client_secret|access_token/i` with literal values

**🟡 WARNING: Poor Variable Usage**
- `HARDCODED_BASEURL`: Request URL contains a hardcoded scheme+host (e.g. `https://api.example.com/...`) instead of starting with `{{baseUrl}}` or `{{host}}` or similar variable
- `HARDCODED_ENV_URL`: URL contains environment-specific strings like `prod`, `staging`, `dev`, `localhost` as a literal hostname
- `MISSING_AUTH`: Request method is POST/PUT/PATCH/DELETE and auth is `noauth` and no Authorization header: flag as potentially unprotected
- `BASIC_AUTH_PLAINTEXT`: Auth type is `basic` with literal username/password instead of variables

**🔵 INFO: Hygiene**
- `MISSING_DESCRIPTION`: Request has no description (count and group them, not one finding per request)
- `NO_COLLECTION_VARIABLES`: Collection defines fewer than 3 variables (considered underdeveloped)
- `INCONSISTENT_AUTH`: More than 2 different auth types in use across the collection
- `EMPTY_HEADERS`: Requests with headers present but all values empty

### 4. `lib/scorer.ts`: Score Calculator

```typescript
interface ScoreBreakdown {
  total: number;           // 0-100
  categories: {
    secrets: number;       // 0-100
    variables: number;     // 0-100
    auth: number;          // 0-100
    hygiene: number;       // 0-100
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;         // 1-sentence human label
}
```

Scoring logic:
- Start at **100**
- Each CRITICAL finding: **-20 points**
- Each WARNING finding: **-8 points**  
- Each INFO finding: **-2 points**
- Floor: **0**
- Grade: A (90+), B (75+), C (55+), D (35+), F (<35)
- Per-category score: score each category independently using only its relevant findings

---

## UI Screens

### Drop Zone (initial state)

Full-screen centered layout. No navbar shown yet.

- Large dashed border rectangle in the center: `border: 1.5px dashed var(--bg-border)`, on hover changes to `var(--accent)`
- Inside: an icon (upload or file), title "Drop your Postman collection", subtitle "Supports .postman_collection.json: parsed locally, never uploaded"
- Below: small `<label>` styled as a ghost button: "or click to browse"
- At the very bottom in muted text: a single line "PostScope: Postman Collection Analyzer"
- The two brand colors (Postman orange `#FF6C37` and PostScope cyan `#2EB8E6`) should appear as two small color dots side by side near the title, like a visual "complement" callout with micro-text: "Postman's complement"

When file is dragged over: the dashed border glows with `box-shadow: 0 0 0 1px var(--accent), 0 0 24px var(--accent-glow)`

### After Analysis: Three-tab Layout

**Header** (fixed, `height: 56px`):
- Left: PostScope wordmark in DM Sans 600 + small "β" superscript in accent color
- Center: Tab navigation: Overview · Security · Score
- Right: collection name in muted text + a small "Analyze another" ghost button (resets state)

**Tab 1: Overview**

Layout: 2 columns on desktop, 1 on mobile

Top row: 4 StatCards:
- Total Requests (number, large)
- Total Folders (number)
- Variables Defined (count of `{{...}}` in collection vars)
- Auth Types (count of distinct types)

Below left: HTTP Methods distribution: horizontal bar chart (Recharts BarChart, horizontal layout). Bars colored:
- GET: `#37B24D` (green)
- POST: `#2EB8E6` (accent)
- PUT: `#F59F00` (amber)
- PATCH: `#7950F2` (violet)
- DELETE: `#F03E3E` (red)
- Other: `var(--text-muted)`

Below right: Auth Types pie chart (Recharts PieChart, donut style). Use semantic colors. Center of donut: large number = total requests.

Full width below: **Request Tree**: collapsible folder list. Each folder shows `▶ FolderName (N requests)`. When expanded, list requests with method badge, request name, and a small lock icon if auth is configured (green) or missing (red).

**Tab 2: Security**

Top: summary bar: "X critical · Y warnings · Z info" with colored dots. Score chip on the right.

Filter row: pill buttons to filter by severity (All · Critical · Warning · Info) and by category (All · Secrets · Variables · Auth · Hygiene)

Findings list: each FindingRow shows:
- Left: Severity badge (colored pill: `CRITICAL`, `WARNING`, `INFO`)
- Category tag in mono font (SECRETS, VARIABLES, etc.)
- Title in medium weight
- Description in secondary text
- `Affected:` list of request names in code style with `var(--text-code)` color
- `Recommendation:` in italic muted text

If zero findings: show a centered empty state with a green checkmark icon and "No issues found. Collection looks clean."

**Tab 3: Score**

Center layout, generous padding.

**Score Gauge**: Large radial arc (Recharts RadialBarChart or custom SVG arc). 
- Arc goes from bottom-left to bottom-right (180° sweep, not full circle)
- Track color: `var(--bg-border)`
- Fill color: dynamic based on score:
  - 90–100: `var(--success)`
  - 75–89: `#74C0FC` (light blue)
  - 55–74: `var(--warning)`
  - 35–54: `#FF8C42`
  - 0–34: `var(--critical)`
- Inside the arc: large score number (48px, DM Sans 300 weight), grade letter below it
- Below: summary sentence

Below the gauge: 4 category breakdown bars:
Each category (Secrets, Variables, Auth, Hygiene) shown as:
`[Category Name]  [horizontal progress bar]  [score/100]`
Progress bar uses the same color scheme as the gauge.

Below: **What this means** section: 3 bullet points of actionable advice based on the actual findings (generated from the findings data, not hardcoded).

---

## StatCard Component

```
┌─────────────────────────────┐
│  [icon]    TOTAL REQUESTS   │
│                             │
│         42                  │
│  ▲ 8 folders               │
└─────────────────────────────┘
```

- Border: `1px solid var(--bg-border)`
- Background: `var(--bg-surface)`
- Icon: Lucide icon in accent color, 16px
- Label: 11px, uppercase, letter-spacing: 0.08em, `var(--text-muted)`
- Number: 36px, DM Sans 300 (light weight): large and airy
- Subtext: 12px, `var(--text-secondary)`

---

## MethodBadge Component

Pill-shaped monospace badges for HTTP methods:
- GET: `color: #37B24D; background: rgba(55,178,77,0.1)`
- POST: `color: #2EB8E6; background: rgba(46,184,230,0.1)`
- PUT: `color: #F59F00; background: rgba(245,159,0,0.1)`
- PATCH: `color: #7950F2; background: rgba(121,80,242,0.1)`
- DELETE: `color: #F03E3E; background: rgba(240,62,62,0.1)`

Font: JetBrains Mono, 11px, font-weight: 500

---

## Micro-interactions

- Tab switching: instant, no animation (keeps it sharp and fast-feeling)
- FindingRow hover: `background` transitions to `var(--bg-elevated)` over 120ms
- StatCard hover: `border-color` transitions to `var(--accent-dim)` over 150ms
- Drop zone: `border-color` and `box-shadow` transition over 200ms
- Score gauge: on mount, animate the arc from 0 to final value over 800ms using a stroke-dashoffset animation
- Folder expand/collapse in Request Tree: height transition 200ms ease

---

## Initialization Commands

Run these in order:

```bash
npm create vite@latest postscope -- --template react-ts
cd postscope
npm install
npm install recharts lucide-react clsx
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Then configure `tailwind.config.ts` to use CSS variables for the color system:

```ts
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        border: 'var(--bg-border)',
        accent: 'var(--accent)',
        critical: 'var(--critical)',
        warning: 'var(--warning)',
        success: 'var(--success)',
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
}
```

Add to `index.css`:
```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
```

Start dev server: `npm run dev`

---

## Sample Test File

Create `public/sample.postman_collection.json` with a realistic test collection that includes:
- 3 folders (Auth, Users, Products)
- 12 requests total
- Mix of auth types (bearer on some, noauth on others)
- 2-3 hardcoded passwords/tokens to trigger critical findings
- 3-4 hardcoded base URLs to trigger warnings
- Some requests without descriptions
- Some properly variabilized requests to show the score isn't always 0

This lets developers test the app immediately without needing their own collection.

---

## Naming & Branding

- App name: **PostScope**
- Tagline: "See inside your collections."
- The "Post" in PostScope is a nod to Postman. The "Scope" signals analysis/inspection.
- The cyan accent (#2EB8E6) is used for the wordmark's "Scope" half if you want to implement split-color branding: `Post` in white, `Scope` in accent.

---

## Deliverable

A fully functional, locally runnable React app that:
1. Accepts `.postman_collection.json` via drag-and-drop or file picker
2. Parses it entirely client-side
3. Renders Overview, Security, and Score tabs
4. Shows real findings based on the actual collection content
5. Looks like something a senior designer built: not a tutorial project

Run `npm run dev` and open `http://localhost:5173`.
