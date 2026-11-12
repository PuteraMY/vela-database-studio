# PuteraMY Agent Skills integration

Rechecked on 2026-11-12 against [PuteraMY/PuteraMY-Agent-Skills](https://github.com/PuteraMY/PuteraMY-Agent-Skills), after the user announced migration to official sources. The repository contains additional skill directories; this integration deliberately audits the eight names originally requested for VELA.

**Current result: one vendor-original skill folder, seven unchanged legacy custom guides. All eight entrypoints were accessible and read. This is not eight official integrations.** The shared README and [OFFICIAL-SOURCES-AUDIT.md](https://github.com/PuteraMY/PuteraMY-Agent-Skills/blob/main/OFFICIAL-SOURCES-AUDIT.md) explicitly say the migration is unfinished.

## What was verified

1. GitHub tools accessed the updated README, source audit and all eight selected `SKILL.md` files. Seven hashes are unchanged. `frontend-design` changed from the custom guide (`616f3cd…`) to Anthropic's original (`a5333457…`). All changed content and all seven current guides were read.
2. Fetched the original [Anthropic frontend-design folder](https://github.com/anthropics/skills/tree/main/skills/frontend-design), enumerated its files and compared the original entrypoint with the PuteraMY mirror. Both text and Git blob SHA match exactly. The complete original folder contains only `SKILL.md` and `LICENSE.txt`; there are no support scripts/assets or runtime dependencies in that folder.
3. The PuteraMY mirror currently contains only the frontend entrypoint. VELA's copy was completed directly from Anthropic with the original Apache-2.0 license. Both original files are unmodified and hash-locked. The legacy PuteraMY MIT notice remains for the older material; it does not cover Anthropic's folder. See [.agents/SOURCES.md](.agents/SOURCES.md).
4. The seven other names remain custom guides, explicitly classified as legacy in the shared audit and local lock file. Their files are preserved for provenance/continuity; they are not vendor plugins, not validated replacements, and not a basis for an official-integration claim. The earlier application work below used them as generic guidance before this source recheck.
5. `npm run skills:verify` now checks eight entrypoints, the complete selected vendor-folder inventory and nine exact file hashes (eight entrypoints plus one license). The old upstream validator still requires custom headings and an exact frontmatter shape; the **local validator was adapted**, preserving the official skill unchanged. Three isolated negative probes confirmed tampered entrypoint bytes, missing license and tampered license bytes fail validation.
6. The executor skill catalog returned an empty list again during this recheck. Therefore **automatic runtime discovery/registration is not verified**. The verified result is local source copies plus explicit instruction reading, not a native installed plugin. No remote installation or changes to the shared repository were performed.

During the original integration, the first patch copy acquired one extra trailing newline. Hash verification caught and corrected it. The refreshed frontend and license are written from the exact API bytes and pass verification. No upstream source file was changed.

## Relevance and actual use

| Skill | Current provenance | Actual use, including earlier custom-guide integration |
| --- | --- | --- |
| [frontend-design](.agents/skills/frontend-design/SKILL.md) | Original Anthropic folder verified | The refreshed original is used to critique the current screenshots, preserve the client-specified instrument-panel design and keep hierarchy/motion purposeful. Earlier comparison, keyboard and graph work used the older guide; it is not retroactively attributed to the new original. |
| [design-system](.agents/skills/design-system/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported palette/font retention, shared interaction/radius/motion tokens and DESIGN_SYSTEM.md. |
| [fullstack-development](.agents/skills/fullstack-development/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported UI → typed Worker → engine tracing and a bounded comparison contract. No server/auth service was added. |
| [database-architecture](.agents/skills/database-architecture/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported constraint review, differential checks and benchmarks. Server/PostgreSQL/RLS advice does not apply to this browser engine. |
| [security-audit](.agents/skills/security-audit/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported LIKE/CSV hardening, inert markup tests, dependency audit and response headers. See SECURITY.md. |
| [automated-testing](.agents/skills/automated-testing/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported corrected swipe fixtures, regression tests and production-preview execution. |
| [performance-optimization](.agents/skills/performance-optimization/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported measurements, bounded diffs/matching and retained virtualization/code splitting. No field INP claim. |
| [deployment-qa](.agents/skills/deployment-qa/SKILL.md) | Legacy custom guide, unchanged | Earlier guidance supported local CI, production-preview checks and rollback documentation. No deployment performed. |

The official frontend skill explicitly says the brief's words win. VELA's required uppercase micro-labels, Manrope/JetBrains Mono, dark surfaces, thin borders and teal accent are therefore retained even where its generic examples caution against similar defaults. The subject and layout are already specified; no design restart or redundant clarification is needed. Adding Supabase, Neon, authentication, animation frameworks or a new UI framework would contradict this project's architecture and was not done.

## Ongoing workflow

- Keep project rules, tier order, strict types, Bahasa Melayu UI, and engine isolation in AGENTS.md.
- Prefer verified vendor-original guidance. Keep the seven legacy copies labeled as historical custom material until the shared repository supplies reviewed replacements; do not rename unrelated official skills to make eight names appear migrated.
- Preserve upstream files and each source's license. Update only after reviewing content, complete folder inventory and dependencies, then intentionally update locked hashes and run both validators.
- Use unit tests for semantics, differential tests for SQL compatibility, actual-browser tests for UI/Worker boundaries, and production-preview tests for packaged assets and headers.
- Finish and verify P0 before implementing physical indexes in P1. No new agents were spawned in this continuation, consistent with the latest work-alone instruction.
- Production deployment remains a separate approval-dependent action. Local build, preview, CI configuration and verification are authorized development work.
