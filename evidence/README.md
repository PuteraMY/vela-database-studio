# Verification evidence

Captured from commands actually executed in this workspace on 2026-11-12. `verification.json` summarizes final gates; `verify-final.log` is the corresponding skills/typecheck/lint/unit/build output. `benchmark.json` includes raw samples, hardware, strategies and a source hash that was cross-checked against the delivered engine files.

`browser-profile-before-spacer.json` and `browser-profile.json` retain the measured before/after runs. The source investigation identified empty spacer TR elements, not evidence of equivalent visible-content movement. Samples are unthrottled local Chromium lab runs; no field INP or continuous 60fps claim follows from them. `ui-inspection.json` records five actual viewport geometries and collected console/page issues. Larger screenshots remain in gitignored `artifacts/screenshots/` and can be recreated with the documented command.

Differential summaries exclude large generated schema fixtures but retain counts, categories, scope exclusions and failure records. Full fixtures remain in local artifacts and are reproducible with the recorded seed. Curated queries and explicit expected results live in `tools/curated.ts`.

`security-audit-final.json` is the actual point-in-time npm audit result. `like-before.json` records the safely bounded original backtracking reproduction. `skill-validator-regressions.log` records the three temporary-copy tampering/missing-license probes. The exact source/license hashes and source URLs are checked into `.agents/skills.lock.json`; one selected folder is vendor-original, seven are legacy custom guides. Local copies do not establish runtime discovery or plugin installation.

`github-ci.json` records the first successful GitHub Actions run after the user created the VELA repository, including the exact tested commit, job steps, counts read from actual logs and nonblocking tooling warnings. This is remote CI evidence, not hosted production verification. No B+tree, WAL, MVCC or production-deployment evidence is claimed.

P1B-2B evidence (2026-11-13): `p1b2b-verification.json` records gates, reused results after interruption, the four initial browser locator failures and four corrected passes. `p1b2b-verify.log` retains core output. `p1b2b-indexed-sql-benchmark.json` retains paired SQL samples and actual source evidence; `p1b2b-scan-benchmark.json` is the original scan/join regression. Full browser/fuzz/raw benchmark artifacts remain gitignored. Local evidence does not claim a remote CI or deployment result.
