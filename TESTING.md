# Testing record

## Scope

P0 is the release boundary. Tests do not pretend to cover absent B+trees, optimizer rules, WAL recovery, MVCC, transactions, or P3 SQL. All commands were run in the supplied Linux workspace. No installation or network blockers remained; npm and Playwright Chromium installed successfully.

## Engine verification

- `npm test`: 268 tests passed (203 original semantics/tokenizer/parser/constraint cases, 18 SQLite-verified regression cases, 17 CSV/dataset/statement-splitting cases, 30 LIKE/export/comparison hardening cases).
- `npm run typecheck`: strict TypeScript passed.
- `npm run lint`: zero errors/warnings on the verified tree.
- `npm run build`: Vite production bundle built; separate app, React, editor and Worker chunks avoid size warnings. Fonts and WASM are local assets.
- `npm run curated`: 100/100 hand-written queries matched their explicit expected results in both engines.
- `npm run fuzz`: 5,000/5,000 queries matched at seed 355866, across 25 randomized schemas and 20 query categories. Initial run was 4,922/5,000. All 78 mismatches in that run were fixed: REAL division (40), Unicode LIKE folding (20), negative-start SUBSTR (13), boolean IS predicates (5).

Fuzzer comparison uses ordered values and a 1e-10 floating-point tolerance. Labels are excluded. SQL subqueries, CTEs, set operations and window functions are excluded because P3 is absent; three explicit subquery rejection probes are recorded separately and are not counted as matches.

## Browser testing

The Playwright suite drives actual CodeMirror, the Worker, IndexedDB and SQLite WASM. Desktop is 1440×960; mobile is 390×844. Additional tests exercise 360, 768, 1100 and 1440 widths, schema drawers, swipe, touch targets and reduced motion. Assertions cover SQL execution, NULL rendering, multi-statement constraints, localized errors, plan replay/stepping, all datasets, CSV upload/error feedback, snippet reload, command palette focus, sorting, CSV/JSON exports, nonempty/empty SQLite comparison, 100k-result virtualization, a checked SELECT lab, honest later-tier panels, metrics, and startup console/network cleanliness.

The unavailable transaction and B-tree actions are not tested as implemented features. One test confirms BEGIN is rejected without changing existing data. Automated axe WCAG A/AA checks cover the loaded desktop and mobile studio; this is not a complete manual screen-reader conformance certification.

Final built-preview result: **62/62 passed**, zero skipped, unexpected or flaky tests; 67.081 seconds. `npm run test:production` started the actual production bundle with the headers from vercel.json. Additional tests cover inert markup, spreadsheet-safe export, roving keyboard tabs, four-table graph bounds, a concrete SQLite cell difference and CSP/security headers. There were no collected startup page errors, console warnings/errors or failed asset requests in the corresponding assertions.

`npx tsx tools/inspect-ui.ts` captured all five widths; document/body scroll widths exactly matched each viewport. Screenshots are under `artifacts/screenshots/`. 360, 768, 1100 and 1440px screenshots were visually inspected, in addition to browser geometry assertions. The built preview uses port 4173; set `VELA_PROFILE_URL` to inspect a different local URL.

## Real bugs and rough edges found and corrected

1. **Startup favicon 404:** browser console/network inspection found a failed request. Added a local SVG icon and explicit icon link.
2. **EOF SQL error had no squiggle:** running `SELECT (1 +` placed a zero-width diagnostic after the last character. The final character is now marked, with the Malay diagnostic available inline.
3. **Command palette focused Close instead of search:** React autofocus ran before `showModal`. Dialog focus now explicitly selects its marked input after opening.
4. **Mobile command button lacked an accessible name:** hiding its visible label also hid its computed name. Added a complete explicit label, verified by role-based interaction and axe.
5. **Mobile export toolbar intercepted result tabs:** its flex width overlapped Banding SQLite. A two-row grid separates tabs from export controls; SQLite mode is clickable on mobile.
6. **Empty SQLite result falsely showed a mismatch:** sql.js omits empty result sets. Compare each tokenized SELECT individually and normalize missing result rows to an empty array. Quoted semicolons remain intact.
7. **Schema preview links failed AA contrast:** their opacity reduced contrast to 3.3:1. Restored full muted-token opacity; rerun axe checks the result.
8. **Plan graph had nested interactive semantics:** focusable operator buttons were inside an image role. The SVG is now a named group, and operators derive names from their visible text/details.
9. **Graph labels disagreed with accessible names:** abbreviated visible units and table names were omitted from custom labels. Removed conflicting labels so visible operator text participates directly.
10. **Code editor scrolling was not keyboard reachable in the accessibility audit:** the scroll region now has a tab stop and Malay label; text editing remains a separate focus target.
11. **Small mobile toolbar targets:** screenshot/geometry inspection found 32–40px controls. Expanded them to 44px and removed the redundant mobile new-query icon; the command palette retains the same action.
12. **Stale error markers after editing:** changing SQL now clears the prior execution error, preventing an old offset from annotating unrelated new SQL.
13. **Four-table plans clipped scan nodes:** the graph assumed two scans. It now computes a wider viewBox/container for additional sources and allows internal horizontal scrolling. The four-table browser test verifies every scan fits inside the SVG bounds.
14. **ARIA tabs did not support arrow navigation:** inspector/result tabs now use roving tabindex and Arrow/Home/End behavior, verified on both viewports.
15. **Export ignored the selected view sort:** copy/download now receive the ordered view rows; browser export tests verify the displayed order.
16. **CSV export could activate spreadsheet formulas:** added formula-text neutralization for cells and headers, preserving ordinary numbers and lossless JSON. Unit/browser tests read the real downloaded file.
17. **SQLite mismatch feedback gave no concrete values:** added a typed, bounded cell-difference response and visible statement/row/column/value details. A known unsupported date format exercises the mismatch UI.
18. **Adversarial LIKE monopolized execution:** reproduced regex backtracking, replaced it with bounded wildcard matching and reran differential tests. This was an engine/security finding rather than a visual defect.
19. **Empty virtual spacers painted as moving data rows:** browser LayoutShift sources identified empty spacer `TR` elements. Disabling scroll anchoring and fixing column widths did not resolve it. Hiding the empty spacer paint while preserving height did; the 100k-result test now scrolls across sixty positions outside the recent-input window, checks layout shift below 0.1 and verifies the final record remains visible. This corrects spacer rendering/measurement; it is not evidence that visible data previously moved by the large reported score.

Each has a reproducible browser path or automated audit/geometry assertion. The underlying engine review additionally fixed 18 independently reproduced semantic/validation failures, including comparison precedence, REAL affinity, alias shadowing, wildcard checks on empty tables and ordinal bounds.

## Test-process notes

The first full browser run passed 30/38 and found eight failing project/test combinations. The next passed 36/38: one remaining accessible-label mismatch and one navigation abort caused by formatting/restarting Vite while tests ran. That abort was test-process interference, not an engine result failure. Final verification freezes application files while browser tests run. Delegated reviewers did not cause this rework.

A later 48/50 run exposed invalid synthetic Touch fixtures without identifiers. Correct Touch/TouchEvent instances fixed the harness; the application swipe handler was then exercised successfully. The first profiling harness also leaked an esbuild `__name` helper into the browser and recorded no frames. That run was discarded. The corrected raw-source initialization collected real desktop and mobile frame intervals with zero errors; the final corrected run collected 99 desktop and 91 mobile intervals.

## Skills, security and performance evidence

- `npm run skills:verify`: locally adapted structural validation, eight entrypoint hashes and one vendor-license hash pass. The official-source recheck verifies one complete Anthropic folder and seven unchanged legacy guides. Three isolated negative probes reject modified entrypoint bytes, a missing license and modified license bytes. See SKILLS_INTEGRATION.md for provenance and runtime-discovery limits.
- Initial `npm audit --json`: 10 findings (2 critical, 8 moderate). Final audit: zero, after the existing test-tool upgrade and scoped transitive override. See SECURITY.md.
- `npm run benchmark`: real 100k-row results and hardware are in BENCHMARK.md and `evidence/benchmark.json`; source hashes did not change during the run.
- `npx tsx tools/browser-profile.ts`: production preview, Chromium 158, one unthrottled sample per viewport. Initial CLS was 0.0041/0.0061; p95 sampled frame intervals were 16.7/16.7ms, with maximum 50.0/33.4ms. After the empty-spacer fix, scripted-workload CLS is 0.0065/0.0061; the earlier 10.62/32.82 samples and the investigation remain available as before/after evidence. Event Timing maxima are not field INP.
- Local CI configuration was authored but has not run on GitHub. No hosted production verification or deployment is claimed.
