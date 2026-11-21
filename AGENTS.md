# VELA engineering rules

## Scope and tier order

Work alone. Complete and verify P0 (engine + studio) before P1 (pages, B+tree, optimizer), then P2 (transactions, WAL, MVCC), then P3 (advanced SQL). Never represent a placeholder as a completed feature. Record scope decisions in DECISIONS.md and commands/results in PROGRESS.md and TESTING.md. Commit each completed tier or major feature.

Current authorized milestone: P1C-2C controlled CPU/GC profiling, based on verified P1C-2B `ff22873c11d7ed1595125081f60df958cb394b7e`. The new P1C-2C mission supersedes the previous milestone stop rule. Work alone, no subagents. Establish reproducible CPU, allocation and GC evidence before any engine/threshold change; preserve SQL/index/streaming semantics. Work detached from the verified base until verification, then create `feat/vela-p1c2c-controlled-profiling` and a stacked PR targeting `feat/vela-p1c2b-planner-calibration`. Preserve PRs #1–#7/main. No merge/rebase/force-push/deployment, destructive changes, general optimizer, SQL expansion, P2 or P3. Do not manufacture a performance fix when evidence is inconclusive.

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

Never claim a check passed without running it. Keep generated evidence under artifacts (gitignored large output). Report measured timings and hardware. Gate tier completion on all four core commands. Static output is dist. Source is published to the user-created PuteraMY/vela-database-studio repository; production deployment is not requested.

## Project-local skills

The eight user-selected entries are retained byte-for-byte under `.agents/skills/`; see SKILLS_INTEGRATION.md and `.agents/SOURCES.md` for provenance and catalog limitations. After the upstream migration recheck, frontend-design is the complete original Anthropic folder (Apache-2.0); the seven other names remain legacy custom guides, not official vendor integrations. Run `npm run skills:verify` after changes. User/project constraints override generic server, PostgreSQL, authentication or service recommendations. Do not rewrite the app or add services merely to follow a generic skill. Preserve each source's license and locked hashes; the legacy MIT notice does not cover vendor originals. These are project-local files; automatic cloud catalog discovery has not been verified.

## Release checks

`npm run verify` runs skill integrity, typecheck, lint, unit tests and build. `npm run test:production` drives the built app with the intended static headers; run after build and do not edit application/config files during this suite. Then run curated/fuzz and benchmarks. CI configuration is local until pushed and executed; never claim a remote CI or deployment pass from a local run.

## Independent frontend maintenance track (owner-authorized; proposed, not active until merged)

The owner separately authorizes tightly scoped frontend-only maintenance alongside the P1C-2C engine profiling milestone. This track may fix verified accessibility, responsive-layout, Results Grid and Playwright regressions in `src/components/`, frontend presentation code, styles, and frontend tests only. It does **not** authorize changes to `src/engine/`, SQL semantics, indexes, optimizer thresholds, performance experiments, dependency manifests, lockfiles, `.github/`, `.agents/`, this `AGENTS.md`, secrets, or deployment configuration. Existing frontend architecture and Bahasa Melayu UI must remain intact. Review existing draft PRs #8, #10, #11, #12 and their changed files before choosing a task; do not duplicate or overwrite overlapping work. Prefer one isolated failing-test repair at a time, with a dedicated branch and draft PR based on the correct integration branch. Do not merge, rebase, force-push or deploy. Run skills verification, typecheck, lint, unit tests, production build and browser tests before reporting success. A read-only audit with no code changes is a valid result and must not be described as a code fix.
