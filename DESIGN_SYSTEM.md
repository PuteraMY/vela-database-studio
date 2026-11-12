# VELA design system

The existing visual language is retained. This is a database instrument panel, with dense information and visible engine activity; it is not a marketing page or a new design direction.

The refreshed original Anthropic frontend-design skill was reviewed against this brief. Its instruction to honor the client's explicit direction applies: VELA keeps the required dark/teal palette, uppercase micro-labels, mono data and thin rules. The schema → SQL → results → execution flow is the subject-specific organizing idea. Screenshot critique focuses on readable hierarchy, controlled density and meaningful states rather than adding decorative effects or a marketing hero.

## Foundations

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#090C12` | Workspace background |
| `--panel` | `#0F1520` | Editor/results surfaces |
| `--raised` | `#161E2D` | Elevated interactions and selected rows |
| `--border` | `#222C3D` | Thin dividers and boundaries |
| `--text` | `#E8EDF5` | Main text |
| `--muted` | `#8795AB` | Supporting labels |
| `--primary` | `#2EE6C5` | Run action, focus, active state |
| `--blue` | `#5B9DFF` | Data flow and scan operators |
| `--amber` | `#FFB547` | Keys, differences, tier availability |
| `--error` | `#FF5C7A` | Errors |
| `--space-unit` | `8px` | Base layout rhythm; micro typography uses optical exceptions |
| `--radius-control` | `3px` | Controls; panels stay at or below 4px |
| `--focus-ring` | `2px solid var(--primary)` | Visible keyboard focus |
| `--motion-feedback` | `200ms` | Interaction feedback |
| `--motion-explain` | `600ms` | Explanatory animation |
| `--ease-out` | `cubic-bezier(.16,1,.3,1)` | New purposeful transitions |

Manrope is used for UI; JetBrains Mono for SQL, values, counts and timings. Font assets are bundled locally, Latin subset only. Numeric displays use tabular figures. SVG icons are handwritten; graphs use actual engine traces. Existing fixed surface shades are optical variants, not competing copies of the primary color tokens.

## Components and states

- `Dialog`: native modal focus isolation, explicit initial focus, Escape close, return focus to trigger. Keep dialogs on one primary task.
- `Results`: loading, empty, error, message, result and comparison states. A difference table shows statement/row/column coordinates and both values, bounded to 20 differences. Table values are escaped React text.
- Virtual spacer rows reserve scroll height but remain visually hidden; they must not paint moving empty data surfaces or contribute spurious large layout shifts. Visible result rows remain rendered and accessible.
- `Inspector`: automatically activated ARIA tabs support arrows/Home/End. More than two scan nodes expand the graph's scrollable canvas instead of clipping nodes.
- `Schema`: table disclosure, typed columns, real row counts and index definitions. Preview actions maintain AA contrast.
- `Editor`: CodeMirror syntax colors, line numbers, real execution diagnostics, schema completions, accessible scroll region and teal focus indicator.

Results and inspector tabs use the same `navigateTabs` helper. Controls retain custom CSS; no component library or chart dependency was introduced.

## Responsive adoption

At 1100px and above: schema on the left, editor/results in the center, inspector right. At 768–1099px: schema drawer and inspector below results. Below 768px: one panel at a time, five bottom tabs, fixed run action, 44px controls, horizontally scrollable results with a sticky first data column. Swiping panel backgrounds changes panels; editing and table horizontal scrolling keep their native behavior.

Use the actual screens at 360/768/1100/1440, not only CSS inspection. Automated axe checks cover initial desktop/mobile layouts. Keyboard, touch-target geometry, reduced-motion and no-page-overflow tests complement the audit. This does not claim complete assistive-technology certification.

All CSS animation/transition is disabled under `prefers-reduced-motion: reduce`. Plan replay is a recorded explanation, explicitly labeled as such; it is not a claim of a suspended live query.

## Migration policy

Adopt semantic tokens when touching a component, preserving established visual hierarchy and behavior. Avoid large styling rewrites merely to replace every optical shade. A new state requires loading/error/empty behavior, keyboard interaction and a real viewport check. Final screenshots and command evidence are linked from TESTING.md.
