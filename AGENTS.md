# VELA engineering rules

## Scope and tier order

Work alone. Complete and verify P0 (engine + studio) before P1 (pages, B+tree, optimizer), then P2 (transactions, WAL, MVCC), then P3 (advanced SQL). Never represent a placeholder as a completed feature. Record scope decisions in DECISIONS.md and commands/results in PROGRESS.md and TESTING.md. Commit each completed tier or major feature.

## Stack and commands

Vite, React, strict TypeScript without `any`, Zustand, CodeMirror 6, custom CSS/SVG; Vitest and Playwright. SQL engine in src/engine has no UI imports or external runtime dependencies. Execute SQL in a module Web Worker. sql.js is allowed only in differential tests and the SQLite comparison feature.

- npm run dev -- --host 0.0.0.0
- npm run typecheck
- npm run lint
- npm test
- npm run build
- npm run test:e2e
- npm run fuzz
- npm run benchmark
  Run typecheck, lint, unit tests and build after each tier and fix failures before proceeding.

## Code style

Use discriminated unions, explicit error handling, small modules, and English identifiers, comments and documentation. All product copy and SQL diagnostics are in Bahasa Melayu. Mutations must validate constraints atomically per statement. Never silently accept unsupported syntax. Test public behavior and semantic edge cases. No SQL parser, database, graph or chart libraries.

## Design

CSS tokens: background #090C12, panel #0F1520, raised #161E2D, border #222C3D, text #E8EDF5, muted #8795AB, teal #2EE6C5, flow #5B9DFF, amber #FFB547, error #FF5C7A. Manrope UI and JetBrains Mono data fonts, locally bundled. 8px spacing, <=4px radius, 1px borders, 2px teal focus rings. No gradients in purple/blue, glass effects, emoji, pill cards, or stock component-library styling. Respect reduced motion.
Desktop >=1100: schema/editor+results/inspector. Tablet 768–1099: drawer schema and inspector below. Mobile <768: single-panel bottom navigation, >=44px targets, sticky run, no page overflow at 360px.

## Verification and reporting

Never claim a check passed without running it. Keep generated evidence under artifacts (gitignored large output). Report measured timings and hardware. Gate tier completion on all four core commands. Static output is dist. No deployment or external publication is requested.

## Project-local skills

The eight user-selected entries are retained byte-for-byte under `.agents/skills/`; see SKILLS_INTEGRATION.md and `.agents/SOURCES.md` for provenance and catalog limitations. After the upstream migration recheck, frontend-design is the complete original Anthropic folder (Apache-2.0); the seven other names remain legacy custom guides, not official vendor integrations. Run `npm run skills:verify` after changes. User/project constraints override generic server, PostgreSQL, authentication or service recommendations. Do not rewrite the app or add services merely to follow a generic skill. Preserve each source's license and locked hashes; the legacy MIT notice does not cover vendor originals. These are project-local files; automatic cloud catalog discovery has not been verified.

## Release checks

`npm run verify` runs skill integrity, typecheck, lint, unit tests and build. `npm run test:production` drives the built app with the intended static headers; run after build and do not edit application/config files during this suite. Then run curated/fuzz and benchmarks. CI configuration is local until pushed and executed; never claim a remote CI or deployment pass from a local run.
