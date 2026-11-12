# Security review

Review date: 2026-11-12. Scope: this local browser-only VELA repository and its locked dependencies. No live user data, external tenant, production deployment or unrelated repository was modified.

## Trust boundaries

SQL and CSV are untrusted input. The main page sends typed requests to its own Worker. The handwritten engine evaluates an AST; it never uses eval or Function. React renders all SQL, cell values and error messages as text. SQLite runs only in its separate comparison instance. Database state is session memory; snippets use same-origin IndexedDB. Exported files leave the application and may be opened in spreadsheet software.

There are no accounts, credentials, server routes, RLS policies, webhooks or external database connections. Server authentication/authorization, CSRF and SSRF checks therefore do not apply to this architecture. No backend was added to make those checklists appear complete.

## Findings and remediation

| Severity | Evidence | Remediation / verification |
| --- | --- | --- |
| Medium, local availability | `LIKE` converted repeated `%a` into a regex search tree. An 80-character input and 16 repeated `%a` terms plus `%z` exceeded a 500ms post-import deadline; the control completed. Evidence: `artifacts/like-before.json`. | Replaced regex wildcard matching with a Unicode code-point matcher that retries only the latest `%`, avoiding exponential branching. Regression includes 8,000 characters and a one-second generous guard; SQL fuzzer rerun checks semantics. Worst-case work remains O(text × pattern). |
| Medium, exported-data handling | CSV quoted formula-looking text but quotes do not stop spreadsheet formula interpretation. | Prefix formula-like string cells/headers with an apostrophe. Numeric negatives are unchanged. Unit/E2E tests verify the file and unchanged UI value. JSON remains the lossless export. |
| Critical advisory in developer tooling, no production bundle exposure | Initial npm audit reported 10 affected packages (2 critical, 8 moderate), including Vitest/tinypool. | Upgraded existing Vitest to 4.1.12. Remaining minimatch glob-amplification finding required a scoped `@typescript-eslint/typescript-estree` override to 11.0.1; no new runtime service/dependency. Typecheck, lint and tests rerun. Final `npm audit --json` reports zero findings. |
| Defense in depth | Static response headers were unspecified. | `vercel.json` configures CSP, nosniff, referrer policy and disabled camera/microphone/geolocation. The local production preview applies the same values for verification. No remote deployment is claimed. |

The CSP allows same-origin scripts/assets and `wasm-unsafe-eval` for SQLite WASM compilation. It permits inline styles because CodeMirror and dynamic SVG/React styling require them. It does not allow general JavaScript `unsafe-eval`, remote script sources, object embeds, framing, or form submissions. Headers are verified locally; actual hosting propagation must be checked after an approved deployment.

## Regression coverage and residual limits

- Hostile HTML strings remain inert result text; no raw HTML injection API is used.
- CSV import validates quoting, column counts and inferred types before publishing state. SQL constraints validate the complete candidate state before mutation.
- `.env` files are ignored; the static app requires no secrets or runtime environment variables.
- Developer dependency overrides are narrow and recorded. Review/remove the minimatch override when the upstream parser package adopts a patched version.
- Very large SQL inputs, Cartesian joins, result arrays and CSVs can still exhaust browser memory or occupy the Worker. There is no sandbox escape, multi-user security boundary or general query resource governor claimed. Reloading loses session data by design in P0.
- IndexedDB snippets are accessible to scripts on the same origin. They are not encrypted storage for secrets.
- Audit results are point-in-time registry findings, not proof that all vulnerabilities are absent.
