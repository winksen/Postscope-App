# PostScope visual style

Guidelines for how PostScope should look and read in the UI, marketing pages, and user-facing copy. For component APIs and Tailwind patterns, see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

**Source of truth**

- Color and radius tokens: `src/index.css`
- Tailwind theme: `tailwind.config.ts`
- Marketing shell: `src/components/marketing/marketing-shell.tsx`
- App shell: `src/components/layout/*`

---

## 1. Voice and punctuation

### No em dashes

Do **not** use the em dash character (Unicode U+2014) anywhere in the project: UI strings, docs, comments, demo collection names, or page titles.

| Instead of | Use |
|------------|-----|
| `Feature` + em dash + `detail` | `Feature: detail`, `Feature, detail`, or two sentences |
| `PostScope` + em dash + `tagline` | `PostScope: tagline` or a comma |
| Empty table cell em dash | `-`, `N/A`, or `None` |

**Why:** Em dashes read like generic AI copy. Short sentences, commas, and colons match the rest of the product tone.

### Tone

- **Direct and concrete.** Say what happens (`Parsed in your browser`, not `Leverage local-first processing`).
- **Privacy-forward.** Lead with local parsing and no upload when describing imports.
- **Calm, not hype.** Avoid exclamation marks and superlatives in product UI.
- **Sentence case** for headings and buttons (`Analyze a collection`, not `Analyze A Collection`).

---

## 2. Brand and layout personality

PostScope is a **SaaS-style dashboard** with a **light-first** palette and optional **dark mode** (`class` on `html`, see `use-theme.tsx`).

- **Minimal chrome:** Neutral backgrounds, cards for modules, and restrained foreground/muted active states.
- **Data-forward:** Metrics, charts, and findings should dominate; decoration stays subtle.
- **Separated review lanes:** Security pages show security-impact categories (`secrets`, `auth`, `variables`). Hygiene pages show maintainability notes (`hygiene`) such as missing descriptions.
- **Two surfaces:**
  - **Marketing** (`LandingPage`, samples entry): centered hero, soft blobs, frosted cards (`bg-card/60`, `backdrop-blur-sm`).
  - **Dashboard** (`DashboardShell`): fixed sidebar + header, darker light-mode `background` page wash, `p-6 lg:p-8` content padding.

### Postman relationship

Postman orange (`text-orange-400` on marketing hero copy only) is a **reference accent**. Do not use orange for sidebar active states, dashboard navigation, logo icons, focus states, or operational UI.

---

## 3. Color

Semantic colors are **HSL components** in CSS variables (no raw hex in components).

| Token | Role |
|-------|------|
| `background` / `foreground` | Page base |
| `card` | Elevated panels, header, drop zone |
| `primary` | CTAs, key icons, active nav |
| `muted` / `muted-foreground` | Secondary text, subtle fills |
| `destructive` | Errors, critical severity |
| `success`, `warning`, `critical` | Severity and positive states (arbitrary `hsl(var(--…))` where needed) |
| `chart-1` … `chart-5` | Recharts series (muted neutrals + destructive for emphasis) |

**Light mode:** Cool gray base (`220` hue family) with a slightly darker page background so white/card surfaces stand out. Use `bg-card` for search bars, notices, saved lists, and modal rows that need clear separation.

**Dark mode:** Deeper `background`, lifted `card`, brighter `primary` for contrast.

**Rules**

- Prefer Tailwind semantic classes: `bg-card`, `bg-muted/40`, `text-muted-foreground`, `border-border`.
- Use opacity modifiers (`/10`, `/60`) for tinted surfaces, not new hex values.
- Severity colors must stay consistent with `SeverityBadge` and security views.
- Active navigation and major inverted CTAs use `bg-foreground text-background`, not orange.
- Focus and hover borders should use neutral `ring` / `border-ring` unless a severity state is being edited.
- Do not label hygiene-only issues as security findings in page titles, request detail sections, or sidebar counts.

---

## 4. Typography

| Role | Implementation |
|------|----------------|
| Family | **Elms Sans** (Google Fonts in `index.css`; `font-sans` and `font-mono` both map to Elms Sans) |
| Page title | `text-2xl font-semibold tracking-tight` |
| Marketing hero | `text-4xl` … `text-6xl font-semibold tracking-tight` |
| Body | `text-sm` default; `text-base` for marketing leads |
| Muted copy | `text-sm text-muted-foreground` |
| Metrics | `text-2xl font-semibold tabular-nums tracking-tight` |
| Micro labels | `text-xs font-medium uppercase tracking-wider text-muted-foreground` |

Use `tabular-nums` for scores and counts. Use `tracking-tight` on headings. Do not introduce one-off font families per screen.

---

## 5. Spacing, radius, and motion

| Item | Value |
|------|--------|
| Base radius | `--radius: 0.75rem` (`rounded-lg` on cards and controls) |
| Section gaps (dashboard) | `gap-6 lg:gap-8` between major blocks |
| Card padding | `p-6` via `Card` defaults |
| Toolbar gaps | `gap-3` or `gap-4` |

**Motion:** Short transitions (`duration-200`, `duration-300`) on hover and theme changes. Marketing uses light fade-in animations (`animate-fade-in`, blob backgrounds). Avoid distracting loops in dashboard views.

**Glass:** `.glass` utility for translucent headers; marketing cards use `backdrop-blur-sm` on `bg-card/60`.

---

## 6. Icons

| Context | Library |
|---------|---------|
| Marketing landing | Phosphor (`@phosphor-icons/react`) |
| Dashboard and analyzer | Phosphor (`@phosphor-icons/react`) |

Use Phosphor icons everywhere. Prefer `weight="fill"` for navigation, summary cards, feature tiles, marketing icons, and dashboard action icons. Keep icon size aligned with text: `h-4 w-4` inline with buttons, `h-5 w-5` in feature tiles, `h-7 w-7` for hero icons.

---

## 7. Core UI patterns

### Buttons

- Primary: solid neutral/inverted treatment for high-emphasis CTAs when they sit on light marketing or upload pages (`bg-foreground text-background`).
- Secondary: `variant="secondary"` for alternate paths and selected segmented controls.
- Destructive: only for irreversible actions.

### Cards

- Default dashboard module surface: `Card` + `CardHeader` / `CardContent`.
- Hover polish: `transition-shadow duration-200 hover:shadow-md` where appropriate (`StatCard`).
- Import zone: card surface with an inner drop surface, centered content, large filled icon in `rounded-2xl bg-muted`. Avoid dashed outlines.
- Dashboard metric rows should use shared `StatCard` patterns before one-off mini-stat blocks.

### Badges

- HTTP methods: `MethodBadge` colors (do not invent new method colors per page).
- Severity: `SeverityBadge` variants (`critical`, `warning`, `info`, `success`).

### Charts

- Recharts with theme chart tokens; tooltips via shared chart tooltip component.
- Donut and bar charts: muted fills, destructive only for emphasis.

### Empty states

Use `-` or short words (`None`, `N/A`) for missing field values, never an em dash.

---

## 8. Accessibility

- Preserve visible focus rings (`ring` token); do not remove focus styles without a replacement.
- Maintain contrast for `muted-foreground` on `background` and `card` in both themes.
- Prefer semantic HTML and Radix primitives for dialogs, tabs, and menus.

---

## 9. Checklist for new UI

1. Copy uses commas, colons, or periods; **no em dashes**.
2. Colors come from CSS variables / Tailwind tokens.
3. Typography follows the scale above (Elms Sans, `tracking-tight` headings).
4. Layout matches marketing or dashboard shell conventions.
5. Icons use Phosphor, usually `weight="fill"` for visible UI.
6. Severity and method colors reuse existing badge components.

---

## Related docs

- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md): components, grids, and code examples
- [ARCHITECTURE.md](./ARCHITECTURE.md): app structure and data flow
