# PostScope: Design System

Practical guidance for building UI that matches PostScope: **Tailwind-first**, **shadcn/ui composable primitives**, offline-safe **Elms Sans** typography, and **HSL CSS variables** for theming.

For voice, punctuation, and overall visual personality, see [VISUAL_STYLE.md](./VISUAL_STYLE.md).

**Source of truth**

- Tokens: `src/index.css` (`:root`)
- Tailwind mapping: `tailwind.config.ts`
- Components: `src/components/ui/*`
- Reference layouts: `src/components/layout/*`, `src/pages/*`

---

## 1. Global design principles

### Philosophy

- **SaaS dashboard, minimal chrome:** Calm neutrals, one strong primary (blue), data-forward density without clutter.
- **Composable, not rigid:** Prefer shadcn patterns: assemble `Card` + `Button` + primitives rather than one-off mega-components unless a feature truly needs it (e.g. `StatCard`).
- **Light mode first:** `darkMode: ['class']` exists in Tailwind; tokens in `:root` are light. If dark mode ships later, add `.dark { … }` variables and test every semantic color.

### Spacing & layout rules

- **Page content** sits in `DashboardShell`’s `main` with `p-6 lg:p-8`. New dashboard pages should assume that padding unless full-bleed is required.
- **Vertical rhythm:** Stack sections with `flex flex-col gap-6 lg:gap-8` for major page blocks (see Overview / Security / Score pages).
- **Horizontal density:** Prefer `gap-3` or `gap-4` in toolbars; `gap-6` between large cards.

### Visual hierarchy

1. **Page title:** `text-2xl font-semibold tracking-tight`
2. **Subtitle / lead:** `text-sm text-muted-foreground` with `mt-1`
3. **Card title:** `CardTitle` → `text-lg font-medium` (component default)
4. **Supporting labels:** `text-xs font-medium uppercase tracking-wider text-muted-foreground` for section micro-labels (modals, metadata blocks)

---

## 2. Layout system

### App shell

| Region | Implementation | Notes |
|--------|----------------|-------|
| Sidebar | `AppSidebar`, fixed `left-0`, `z-40`, width `w-60` or `w-[72px]` collapsed | Nav only; brand + `NavId` items |
| Header | `AppHeader`, fixed `top-0`, `z-30`, `left` = sidebar width | Search, collection name, actions |
| Content | `DashboardShell` `main`, `pt-14`, `paddingLeft` = sidebar width | Children wrapped in `p-6 lg:p-8` inside `main` |

Shell background: `min-h-screen bg-muted/50`. Cards and header use `bg-card` / `bg-background/80` for contrast.

### Grid conventions

- **Stat / KPI row:** `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`
- **Two-column charts:** `grid grid-cols-1 gap-6 lg:grid-cols-2`
- **Responsive default:** Mobile single column; break upward at `sm:` / `lg:` / `xl:` as above.

### Section spacing

- Between **title block** and first grid: rely on parent `gap-6 lg:gap-8` (no extra margin) for consistency.
- Inside **cards**: use `Card` defaults (`p-6` header/content) or override sparingly with `cn()`.

---

## 3. Component standards

Import primitives from `@/components/ui/...`. Use `cn()` from `@/lib/utils` to merge classes.

### Cards

**When to use:** Group related content, metrics, charts, or filters. Default surface for dashboard modules.

**Structure**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

<Card className="transition-shadow duration-200 hover:shadow-md">
  <CardHeader>
    <CardTitle>HTTP methods</CardTitle>
    <CardDescription>Distribution of verbs across the collection</CardDescription>
  </CardHeader>
  <CardContent>{/* chart or body */}</CardContent>
</Card>
```

**Defaults (from `card.tsx`):**

- Container: `rounded-xl border border-border/80 bg-card shadow-sm`
- Header / content padding: `p-6`; content `pt-0` to nest under header

**Variants:** No CVA; use `className` on `Card` for hover (`hover:shadow-md`, `hover:border-primary/20`) like `StatCard`.

---

### Buttons

**When to use:** Primary actions, nav pills, icon-only tools, destructive confirmations.

**Variants** (`button.tsx`, `class-variance-authority`)

| Variant | Use |
|---------|-----|
| `default` | Primary CTA, `bg-primary` |
| `secondary` | Secondary emphasis; selected nav style often matches |
| `destructive` | Delete / irreversible |
| `outline` | Tertiary on busy backgrounds |
| `ghost` | Sidebar nav, low-emphasis actions |
| `link` | Inline text actions |

**Sizes:** `default` (`h-9`), `sm` (`h-8`, `text-xs`), `lg`, `icon` (`h-9 w-9`)

**Example**

```tsx
<Button variant="default" size="sm">Save</Button>
<Button variant="ghost" size="icon" aria-label="Collapse"><ChevronLeft className="h-4 w-4" /></Button>
```

**Interaction:** `transition-colors duration-200`, `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.

---

### Inputs & forms

**When to use:** Search fields, future settings forms. Pair with `Label` for accessibility.

**Input** (`input.tsx`): `h-9`, `rounded-md`, `border-input`, `text-sm`, `focus-visible:ring-2 focus-visible:ring-ring`.

**Example: search pattern (header)**

```tsx
<Input
  placeholder="Search findings, requests…"
  className="h-9 bg-muted/40 pl-9 transition-colors duration-200 hover:bg-muted/60 focus-visible:bg-background"
/>
```

**Label** (`label.tsx`): `text-sm font-medium leading-none`.

**Forms (future):** Wrap field + label in `space-y-2`; use `disabled:` styles inherited from primitives; prefer `Select` / `Dialog` from `ui/` for complex pickers.

---

### Tables

**When to use:** Dense, scannable lists (e.g. Security findings). Use with `Card` wrapper when the table is the main module.

**Parts:** `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, optional `TableCaption`.

**Semantics**

- Header cells: `text-xs font-medium text-muted-foreground`, `h-10 px-4`
- Body cells: `p-4`, `text-sm` inherited from `Table`
- Rows: `hover:bg-muted/40`, `duration-200`

**Example**

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Severity</TableHead>
      <TableHead>Title</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell><Badge variant="destructive">critical</Badge></TableCell>
      <TableCell>Hardcoded token</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

Embed in `ScrollArea` if vertical space is constrained.

---

### Modals & dialogs

**When to use:** Focused task or detail (`RequestAnalysisModal`), confirmations, multi-step flows.

**Pattern:** Radix `Dialog` from `ui/dialog.tsx`.

- Overlay: `bg-black/40 backdrop-blur-[2px]`
- Content: `max-w-lg`, `p-6`, `sm:rounded-xl`, enter/exit animations per data attributes

**Composition**

```tsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
      <DialogDescription>Supporting copy</DialogDescription>
    </DialogHeader>
    {/* body */}
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Custom layouts:** You may use `p-0` on `DialogContent` and subdivide (see `RequestAnalysisModal`). Keep header strip visually distinct (`border-b bg-muted/30`) for consistency.

---

### Badges

**When to use:** Status chips, counts, severity, compact metadata.

**Variants** (`badge.tsx`)

| Variant | Use |
|---------|-----|
| `default` | Strong emphasis, primary fill |
| `secondary` | Neutral tag |
| `destructive` | Error / critical |
| `outline` | Subtle border context |
| `success` | Positive / secure, uses `--success` tint |
| `warning` | Caution, uses `--warning` tint |
| `critical` | Soft destructive text, `bg-destructive/10 text-destructive` |

**Example**

```tsx
<Badge variant="success">Score 92/100</Badge>
<Badge variant="warning" className="font-mono text-xs tabular-nums">Score 60/100</Badge>
```

---

### Tabs

**When to use:** Switch related views without navigation (e.g. Score page breakdowns).

**Pieces:** `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`

**Defaults**

- List: `rounded-lg bg-muted/60 p-1`, `h-9`
- Trigger: active state `bg-background shadow-sm text-foreground`, `duration-200`

**Example**

```tsx
<Tabs defaultValue="overview">
  <TabsList>
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="detail">Detail</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">{/* panel */}</TabsContent>
</Tabs>
```

`TabsContent` includes `mt-6`. Do not strip unless the design needs tighter spacing.

---

## 4. Typography system

**Font:** Elms Sans (`font-sans` and `font-mono` in `tailwind.config.ts`; both point to Elms Sans with system fallbacks; font files are vendored under `public/fonts` for offline use).

| Role | Classes | Notes |
|------|---------|-------|
| Page H1 | `text-2xl font-semibold tracking-tight` | One per view |
| Dialog / section H3 | `text-lg font-semibold tracking-tight` | `DialogTitle` default |
| Card title | `text-lg font-medium leading-none tracking-tight` | Via `CardTitle` |
| Body | `text-sm` | Default copy |
| Muted body | `text-sm text-muted-foreground` | Descriptions, helpers |
| Micro label | `text-xs font-medium uppercase tracking-wider text-muted-foreground` | Modal sections |
| Metric | `text-2xl font-semibold tabular-nums tracking-tight` | `StatCard` value |
| Table header | `text-xs font-medium text-muted-foreground` | Via `TableHead` |

**Rules**

- Prefer **tracking-tight** on headings for dashboard polish.
- Use **tabular-nums** for scores and counts that align in columns.
- Avoid arbitrary font sizes unless aligning to this scale.

---

## 5. Color system

All semantic colors are **HSL components** (no `hsl()` in variables; Tailwind wraps as `hsl(var(--token))`).

### Core tokens (`:root`)

| Token | Role |
|-------|------|
| `background` / `foreground` | Page base |
| `card` / `card-foreground` | Elevated surfaces |
| `primary` / `primary-foreground` | Brand actions, key accents |
| `secondary` | Subtle fills |
| `muted` / `muted-foreground` | Shelves, secondary text |
| `accent` / `accent-foreground` | Hover surfaces |
| `destructive` / `destructive-foreground` | Errors, destructive buttons |
| `border` / `input` / `ring` | Edges and focus rings |

### Charts

| Token | Typical use |
|-------|-------------|
| `--chart-1` | Primary series / GET |
| `--chart-2` | Success-tinted / secondary series |
| `--chart-3`–`5` | Additional series |

Usage in components: `hsl(var(--chart-1))` or `fill-[hsl(var(--chart-2))]` as in `OverviewPage`.

### Semantic extensions (app-specific)

| Token | Use |
|-------|-----|
| `--success` | Positive states, lock-secured icons, success badges |
| `--warning` | Warnings, caution copy accents |
| `--critical` | Aligns with destructive emphasis where named explicitly |
| `--postman` | Reserved for Postman-adjacent branding accents (use sparingly) |

**In Tailwind:** Prefer `bg-primary/10`, `text-destructive`, `border-border`, `text-muted-foreground`. For success/warning fills not in `theme.colors`, use arbitrary values: `bg-[hsl(var(--success)/0.12)]`, `text-[hsl(var(--warning))]`. Match existing `Badge` patterns.

---

## 6. Spacing system

### Padding

| Context | Convention |
|---------|------------|
| Card header/content | `p-6` (built into components) |
| Page outer (inside shell) | `p-6 lg:p-8` |
| Dialog content | Default `p-6`; custom `p-0` + inner pads if needed |
| Table cells | `p-4` (`TableCell`), header `px-4` |

### Gaps

| Context | Convention |
|---------|------------|
| Page column stack | `gap-6 lg:gap-8` |
| Card grids | `gap-4` (stats) or `gap-6` (charts) |
| Inline toolbars | `gap-2` / `gap-3` |
| Button groups | `gap-1` in header icon clusters |

### Borders & radius

- Global radius: `--radius: 0.75rem` → Tailwind `rounded-lg` = `var(--radius)`.
- Cards: `rounded-xl` in component.
- Small controls: `rounded-md`.

---

## 7. Interaction patterns

### Hover

- **Buttons / links:** Defined per variant (`hover:bg-primary/90`, etc.).
- **Cards:** Optional `hover:shadow-md`, `hover:border-primary/20` for discoverability.
- **Table rows:** `hover:bg-muted/40`, `duration-200`.

### Focus

- Standard: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`.
- Keep **visible focus** for keyboard users. Do not remove ring without a replacement.

### Transitions

- Default interaction duration: **`duration-200`** on colors, shadows, padding (shell uses `transition-[padding] duration-200`).
- Sidebar width / shell layout: `transition-[width] duration-200` or matching `transition-colors`.

### Loading

- Use **`Skeleton`** from `ui/skeleton.tsx`: `animate-pulse rounded-md bg-muted`.
- Pattern: match layout of final content (e.g. table row placeholders). Security page uses a short timed skeleton before showing data. Prefer **content-aware** skeletons over blank spinners.

---

## 8. Charts & data visualization

### Allowed libraries

- **Recharts** is the standard (`ResponsiveContainer`, `BarChart`, `PieChart`, etc.).

### Styling rules

- **Height:** Give charts a fixed wrapper height (e.g. `h-64 w-full`) inside `CardContent` for stable layout.
- **Grid / axes:** Use `stroke-border` or `className="stroke-border"` on `CartesianGrid` / axes to align with tokens.
- **Series colors:** Map methods or categories to `hsl(var(--chart-N))` for consistency with `OverviewPage` (`METHOD_COLORS`, `PIE_COLORS`).
- **Tooltips:** Wrap content in **`ChartTooltipFrame`** (`src/components/charts/chart-tooltip.tsx`) for border, popover background, and shadow:

```tsx
<ChartTooltipFrame>
  <p className="font-medium">{label}</p>
  <p className="text-muted-foreground">Count: {value}</p>
</ChartTooltipFrame>
```

- **Legends:** Keep typography `text-sm` / muted for secondary labels.

### Do not

- Introduce a second chart library without design review.
- Use neon or non-token colors for core series.

---

## 9. Do / Don’t

### Do

- Use **semantic tokens** (`text-muted-foreground`, `bg-card`, `border-border`) instead of raw grays like `text-gray-500` (unless matching a chart edge case).
- Compose **`Card` + `CardHeader` + `CardContent`** around new dashboard modules.
- Match **existing page headers** (`h1` + muted subtitle) when adding routes.
- Use **`truncate`** + **`min-w-0`** on flex children that hold long collection names or URLs.
- Keep **icon size** at `h-4 w-4` in dense UI; `h-3.5 w-3.5` only for inline micro icons in trees.

### Don’t

- Add **raw `alert()`** for UX-critical flows. Use `Dialog` + toast pattern when available.
- Nest **multiple competing primaries** on one screen (one primary `Button` per logical region).
- Replace **Radix primitives** with unstyled divs that need focus traps (dialogs, menus).
- Hardcode **hex colors** for surfaces. Extend `index.css` tokens if a new semantic is needed.
- Skip **`aria-label`** on icon-only `Button`s.

---

## 10. Reusable layout templates

Paste and adapt; keep outer `gap-6 lg:gap-8` aligned with existing pages.

### Dashboard page template

```tsx
export function ExampleDashboardPage() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Page title</h1>
        <p className="mt-1 text-sm text-muted-foreground">Short description of this view.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* StatCards or small Cards */}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Primary Card modules */}
      </div>
    </div>
  )
}
```

### Form page template (future)

```tsx
<div className="mx-auto w-full max-w-lg flex flex-col gap-6">
  <div>
    <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
    <p className="mt-1 text-sm text-muted-foreground">Update preferences for this workspace.</p>
  </div>
  <Card>
    <CardHeader>
      <CardTitle>Section</CardTitle>
      <CardDescription>Fields grouped logically.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="field">Label</Label>
        <Input id="field" />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button">Cancel</Button>
        <Button type="submit">Save</Button>
      </div>
    </CardContent>
  </Card>
</div>
```

### Table page template

```tsx
<div className="flex flex-col gap-6 lg:gap-8">
  <div className="flex flex-col gap-1">
    <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
    <p className="text-sm text-muted-foreground">Filter and inspect results.</p>
  </div>

  <div className="flex flex-wrap items-center gap-3">{/* filters, Badges */}</div>

  <Card>
    <CardHeader>
      <CardTitle>Results</CardTitle>
      <CardDescription>N rows</CardDescription>
    </CardHeader>
    <CardContent className="p-0">
      <ScrollArea className="h-[480px]">
        <Table>{/* … */}</Table>
      </ScrollArea>
    </CardContent>
  </Card>
</div>
```

---

## Maintenance

When adding tokens or variants:

1. Update **`src/index.css`** and **`tailwind.config.ts`** if the token should be themeable.
2. Extend **`ui/*`** with `cva` variants rather than one-off inline colors on every page.
3. Add a short note in this doc under the relevant section.
