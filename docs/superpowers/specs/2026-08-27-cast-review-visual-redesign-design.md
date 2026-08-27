# Cast Review — Visual Redesign

**Date:** 2026-08-27
**Status:** Approved — ready for implementation plan
**Reference:** `~/Downloads/cast-review-prototipo.html` (static HTML prototype provided by user)

## Goal

Current frontend (`apps/frontend`) is a single flat dark theme and reads as confusing/generic. Adopt the visual language of the provided prototype: a two-zone shell (dark "machine" rail/console + light "paper" content), Bricolage Grotesque/Instrument Sans/IBM Plex Mono typography, card-based layouts with soft shadows, pipeline/console visualizations, and a magenta accent — while adding a light/dark toggle the prototype itself doesn't have.

## Non-goals

- **`ProjectGraphPage.tsx`, `RepoGraphPage.tsx`, `project-graph.css` are untouched.** Zero changes to their markup, styles, or the React Flow node/edge rendering. Only the shared `Navbar`/`Layout` chrome that wraps every page (including these two) gets restyled, since that's shared infra, not part of the graph feature itself.
- No new features, no data/behavior changes. Pure visual layer.
- No `prefers-color-scheme` auto-detection — explicit toggle only, default light.

## 1. Design tokens (`apps/frontend/src/index.css`)

Two independent token layers.

### Machine zone (fixed — never toggles)

New vars, consumed only by `Navbar` (rail) and the analysis pipeline/console UI:

| Token | Value | Use |
|---|---|---|
| `--machine-bg` | `oklch(19% 0.010 350)` (~`#101419`) | rail/console base |
| `--machine-bg-2` | `oklch(23% 0.011 350)` (~`#161B22`) | hover/elevated |
| `--machine-bg-3` | `oklch(27% 0.012 350)` (~`#1E252F`) | active nav item, stage node fill |
| `--machine-line` | `oklch(33% 0.013 350)` (~`#2A323E`) | borders |
| `--machine-fg` | `oklch(92% 0.006 350)` (~`#E6EAF0`) | primary text |
| `--machine-fg-2` | `oklch(68% 0.012 350)` (~`#93A0B0`) | secondary text |
| `--machine-fg-3` | `oklch(50% 0.014 350)` (~`#67727F`) | tertiary/labels |
| `--machine-accent-lit` | `oklch(72% 0.19 350)` (~`#FF5E97`) | running-state pulse, stream caret |

### Content zone (existing var names, redefined per theme)

Reuse current names (`--color-surface`, `--color-surface-1/2/3`, `--color-border`, `--color-border-strong`, `--color-ink`, `--color-ink-dim`, `--color-ink-faint`) so no page/component needs to change its Tailwind classes — only the values swap per `data-theme`.

`:root, :root[data-theme="light"]` (default):

| Token | Value | Maps to prototype |
|---|---|---|
| `--color-surface` | `#E6E8EC` | `--paper` (page bg) |
| `--color-surface-1` | `#FFFFFF` | `--surface` (card bg) |
| `--color-surface-2` | `#F4F5F8` | `--surface-2` (table head, subtle fill) |
| `--color-surface-3` | `#EDEEF2` | hover fill (new, not in prototype) |
| `--color-border` | `#D8DCE2` | `--line` |
| `--color-border-strong` | `#C2C8D1` | `--line-strong` |
| `--color-ink` | `#12161C` | `--text` |
| `--color-ink-dim` | `#576070` | `--text-2` |
| `--color-ink-faint` | `#868E9B` | `--text-3` |
| `--color-accent-hover` | `#B01750` | darker than base (light-surface hover direction) |
| `--color-accent-soft` | `#FBE6EE` | pill/soft backgrounds |
| `--color-accent-ink` | `#FFFFFF` | text on solid accent |
| `--color-pass` / `--color-pass-soft` | `#0F6B55` / `#DDEDE8` | finding/verdict pass |
| `--color-warn` / `--color-warn-soft` | `#8A5A0B` / `#F7EBD6` | finding/verdict warn |
| `--color-fail` / `--color-fail-soft` | `#B3261E` / `#FADFDC` | finding/verdict fail |

`:root[data-theme="dark"]`: keep current app's existing dark values for surface/border/ink (already well-tuned, not from prototype) — just flip hover/soft/ink directions:

| Token | Value |
|---|---|
| `--color-surface` → `-3` | current values unchanged (`oklch(13%..23%)`) |
| `--color-border` / `-strong` | current values unchanged |
| `--color-ink` / `-dim` / `-faint` | current values unchanged |
| `--color-accent-hover` | `oklch(70% 0.19 350)` (lighter — dark-surface hover direction, current value) |
| `--color-accent-soft` | `oklch(38% 0.10 350)` (current `--color-accent-quiet`) |
| `--color-accent-ink` | `#FFFFFF` (unify with light; drop old near-black variant) |
| `--color-pass` / `-soft` | reuse current `--color-state-open` family |
| `--color-fail` / `-soft` | reuse current `--color-state-closed` family |
| `--color-warn` / `-soft` | new: `oklch(70% 0.15 80)` / `oklch(28% 0.05 80)` |

`--color-accent` itself (`oklch(62% 0.21 350)`, ~prototype's `#CE1F5D`) stays theme-independent — already close to the prototype value, no change needed. Existing `--color-state-open/closed/draft` tokens (used by `PullRequestStatusBadge`) are untouched — separate domain from finding-severity colors.

### Shape, shadow, type (theme-independent)

- Radius: `--radius-sm:5px`, `--radius-md:9px`, `--radius-lg:14px` (up from current 3/5/8).
- Shadow: `--shadow-card: 0 1px 2px rgba(16,20,25,.05), 0 8px 24px -14px rgba(16,20,25,.22)` for light; dark theme gets its own darker variant (`rgba(0,0,0,...)` based) defined alongside the dark token block.
- Fonts: swap `--font-display` → `'Bricolage Grotesque'`, `--font-body` → `'Instrument Sans'`, `--font-mono` → `'IBM Plex Mono'`. Add the Google Fonts `<link>` tags (from the prototype's `<head>`) to `apps/frontend/index.html`.

## 2. Theme toggle

- `data-theme="light" | "dark"` attribute on `<html>`, default `"light"`.
- Persisted to `localStorage` (`cast-review-theme`), applied before paint (inline script in `index.html` `<head>`, avoids flash-of-wrong-theme).
- `color-scheme` CSS property follows the attribute for native form control theming.
- Small toggle button (sun/moon icon) added to `Navbar`'s `rail-foot`, near sign-out. New `useTheme` hook or small context reads/writes the attribute + localStorage.
- Because content-zone tokens are just CSS var redefinitions consumed by existing Tailwind utility classes (`bg-surface`, `text-ink`, `border-border`, etc.), **no page or component needs code changes for the toggle to work** — only token definitions + the toggle control itself.

## 3. Shell

- `Navbar.tsx` → rail: `--machine-*` bg, brand mark (small accent square, matches prototype), nav items with numbered badges (already has this pattern — keep, restyle colors/radius), user block + sign-out, **new theme toggle** at the bottom.
- `Layout.tsx` → drop the current single wrapping "glass card" (`rounded-lg border ... bg-surface/75 ... backdrop-blur`) around all page content. Prototype has no such outer card — pages sit directly on the content-zone background and build their own cards internally. This matches `.page` (max-width + padding) from the prototype.

## 4. Shared primitives (`apps/frontend/src/components/ui/`)

- `Button.tsx` → restyle to `.btn` variants (primary / ghost / quiet / dark / sm), same props/API.
- `Modal.tsx`, `Field.tsx`, `Spinner.tsx`, `EmptyState.tsx` → restyle to match card/input language (radius, border, shadow, focus ring), no API change.
- **New primitives** (prototype leans on these repeatedly, currently done as ad-hoc divs per page): `Card`, `Tabs`, `Pill` (severity/state badge), `Chip`, `Table`. Extracting these keeps the findings/verdict/cost-table/benchmark work consistent and DRY.

## 5. Page-by-page mapping

| Page/component | Prototype pattern |
|---|---|
| `ProjectsPage` / `ProjectFormPage` | `.proj-grid` cards with repo chips + stat row |
| `ReposPage` / `RepositoryCard` | `.list` / `.row` (status dot, meta right-aligned) |
| `PullRequestsPage` / `PullRequestCard` | same row pattern + `.pr-state` pill |
| `PullRequestReviewPage` | `.pr-head`, tabs (Achados / PRD / Spec / Mudanças / Custos) |
| `AgentStepper` | pipeline track — numbered/gate nodes, running-state pulse animation, connecting rail |
| `ApprovalGate` | amber gate banner with approve/request-changes actions |
| `ReportView` / `ReportMarkdown` | verdict split-card (score bars) + findings accordion with PRD-vs-code contrast panel |
| `ThoughtLog` | console "stream" line with blinking caret |
| `UsageStrip` | console meter (model/tokens/cost) |
| `IterationHistory` | run chips |
| costs tab | `.cost-table` |
| `BenchmarksPage` | case-list sidebar + `.bench-grid` cards |
| `SettingsPage` | `.set-card` with connection status pill |
| `LoginPage` / `RegisterPage` | no prototype reference screen — new centered card consistent with the same token/component language |

## Risks / notes

- Accessibility: keep current focus-visible rings and touch targets (≥44px) intact through the restyle — prototype's `:focus-visible` outline pattern already matches what's in `index.css`. Verify 4.5:1 text contrast on both new light and existing dark token sets, especially `--color-ink-faint` on `--color-surface-2`.
- Pure CSS/markup change — no unit test impact expected. Verification is visual: run the app, click through both themes across all pages listed above, confirm graph pages render byte-identical to before.
