# Design Tokens

`app/globals.css`'s `:root` block is this app's design token system — CSS custom properties every
stylesheet in the app can reference via `var(--token-name)`. There is no build-time token pipeline
(no Style Dictionary, no Tailwind theme config generating these) — the tokens are just CSS custom
properties, hand-authored, consumed the same way anywhere in `app/globals.css` or a component's
inline `style` prop.

## Catalog

### Color and surface

| Token | Dark (default) | Light (`[data-theme="light"]`) | Used for |
|---|---|---|---|
| `--bg` | `#090c10` | `#f4f5f7` | Page background |
| `--surface` | `#11161c` | `#ffffff` | Card/panel background (one level up from `--bg`) |
| `--surface-2` | `#171d24` | `#eef0f3` | A second, slightly lighter surface level |
| `--surface-3` | `#202731` | `#e2e5ea` | A third surface level |
| `--border` | `#29313b` | `#d6dae0` | Hairline borders |
| `--text` | `#f4f7fa` | `#14181f` | Primary text |
| `--muted` | `#8f99a7` | `#5b6572` | Secondary/label text |

### Accent (Toyota red)

| Token | Value | Used for |
|---|---|---|
| `--accent` | `#eb0a1e` | Primary actions, active states, the CSP-safe brand red |
| `--accent-2` | `#ff3b4a` | A lighter accent variant |

### Typography

| Token | Value |
|---|---|
| `--font-family-base` | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| `--font-size-xs` | `0.6875rem` (11px) |
| `--font-size-sm` | `0.75rem` (12px) |
| `--font-size-md` | `0.8125rem` (13px) |
| `--font-size-lg` | `1rem` (16px) |
| `--font-size-xl` | `1.375rem` (22px) |
| `--font-size-2xl` | `1.75rem` (28px) |
| `--font-weight-regular` | `400` |
| `--font-weight-medium` | `500` |
| `--font-weight-bold` | `700` |

### Spacing

| Token | Value |
|---|---|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `24px` |
| `--space-6` | `32px` |

### Radius and elevation

| Token | Value |
|---|---|
| `--radius-sm` | `7px` |
| `--radius-md` | `9px` |
| `--radius-lg` | `12px` |
| `--shadow-elevated` | `0 18px 45px rgba(0, 0, 0, 0.4)` |

### Motion

| Token | Value |
|---|---|
| `--duration-fast` | `150ms` |
| `--duration-base` | `300ms` |
| `--duration-slow` | `450ms` |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |

## Theming

`color-scheme` is set on `:root` (`dark` by default), and a full light-mode override lives under
`:root[data-theme="light"]`, replacing the color/surface group only (typography, spacing, radius,
and motion tokens are theme-independent by design — only color needs to invert).

**Honest gap:** nothing in this app's UI sets `data-theme="light"` today — there is no theme toggle
control anywhere in `app/components/`. The light values are real, defined CSS and would work the
moment something set that attribute (e.g. on `<html>`), but they're currently dead code from the
running app's point of view. Verified by searching the codebase for `data-theme` — the only
occurrences are this CSS block's own selector and this doc.

## Adoption status — read this before assuming a token is live everywhere

This is the part worth being honest about rather than presenting the catalog above as if every
token is already wired through the app. Counted with `grep -c` against `app/globals.css` itself
(341 lines, the only stylesheet this app has):

| Token group | Actually referenced via `var(...)` | Status |
|---|---|---|
| `--bg`, `--text`, `--border`, `--muted`, `--surface`, `--surface-2`, `--shadow-elevated`, `--accent` | Yes (1–14 uses each) | **Live** |
| `--surface-3`, `--accent-2` | Zero | Defined, unused |
| `--font-size-*`, `--font-weight-*` | Zero | Defined, unused — every component's CSS hardcodes its own `font-size: 13px`-style literals instead |
| `--space-*` | Zero | Defined, unused — every margin/padding/gap in `app/globals.css` is a hardcoded px value |
| `--radius-sm` / `--radius-md` / `--radius-lg` | Zero | Defined, unused — every `border-radius` is a hardcoded px value (and several of those literals — 7px, 9px, 12px — exactly match these tokens' values, just not written as a reference) |
| `--duration-*`, `--ease-standard` | Zero | Defined, unused — no CSS `transition`/`animation` in this file references them |

In short: the color/surface/accent tokens are the actual, load-bearing design system this app
runs on; the typography, spacing, radius, and motion scales are a **forward-declared target** —
real, intentional values (the comment above them reads "Toyota design system"), not yet converged
on by the component CSS written against them. This is the same "declared ahead of the code that
will use it" pattern `docs/INTEGRATION_GUIDE.md` §3 documents for the hood/panel/decal/interior
customization catalog: not a placeholder to distrust, but not evidence the whole app already
consumes it either.

**A related, smaller inconsistency, found while auditing this:** `.brand span`'s color (both the
builder header and `app/explore/page.tsx`'s header use the same rule) is a third, untokenized red —
`#f34a50` — distinct from both `--accent` (`#eb0a1e`) and `--accent-2` (`#ff3b4a`). Three near-identical
reds, only two of them named. Not fixed here — picking which of the three is "correct" and
consolidating the other two is a design decision, not a token-documentation one — but recorded so
it's not mistaken for a token adoption gap. `docs/INTEGRATION_GUIDE.md`'s Known Gaps list carries
this forward.

## Guidance for new CSS

- **Color, surface, borders, muted text, the accent, and elevation:** always use the token
  (`var(--surface-2)`, not a repeated hex literal) — these are live and consistent, and a raw hex
  value here is very likely to silently drift from the token it was probably copied from (see the
  `#f34a50` case above).
- **Typography, spacing, radius, motion:** using the token where a new rule's value happens to
  match one (e.g. `border-radius: var(--radius-md)` instead of `9px`) starts pulling this codebase
  toward actually being on the design system rather than just declaring it. Not required today —
  the existing ~340 lines of component CSS were not written against these tokens and this doc isn't
  asking for a mass rewrite — but a new rule is a good place to start converging rather than adding
  one more hardcoded literal to the pile.
