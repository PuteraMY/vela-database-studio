# PuteraMY Agent Skills integration

Verified on 2026-11-12 against [PuteraMY/PuteraMY-Agent-Skills](https://github.com/PuteraMY/PuteraMY-Agent-Skills). The repository now contains additional skill directories; this integration deliberately selects the eight explicitly requested by the user.

## What was verified

1. The connected GitHub tools successfully accessed the repository, README, eight selected directories, every selected `SKILL.md`, MIT license and upstream validator.
2. All eight complete skill files were read before use. None of the eight was inaccessible.
3. Upstream documents the Codex mechanism as copying directories into the target project's `.agents/skills/`. Exact copies are present here; each file's Git blob SHA matches the API response. The MIT notice is retained in `.agents/skills/LICENSE`.
4. `python3 scripts/validate_skills.py` passed the upstream structural validation. `python3 scripts/verify_skill_sources.py` verifies all eight immutable blob hashes against `.agents/skills.lock.json`. Run both with `npm run skills:verify`.
5. The executor skill catalog returned an empty list both before and after copying. Therefore **automatic runtime discovery/registration is not verified**. These are verified project-local skill files and instructions explicitly loaded into this work, not an installed ChatGPT plugin or cloud-catalog package. No supported remote registration tool was available.

The first copy acquired one extra trailing newline from the patch transport. Hash verification caught it. The copy was corrected and all eight hashes now match byte-for-byte. No upstream files were changed.

## Relevance and actual use

| Skill | Loaded / local copy | Application to VELA in this continuation |
| --- | --- | --- |
| [frontend-design](.agents/skills/frontend-design/SKILL.md) | Verified | Preserve the existing studio; improve comparison feedback, keyboard tab navigation, four-table plan layout, and mobile interaction verification. |
| [design-system](.agents/skills/design-system/SKILL.md) | Verified | Retain the original palette and fonts; add shared interaction/radius/motion tokens and document their usage in DESIGN_SYSTEM.md. |
| [fullstack-development](.agents/skills/fullstack-development/SKILL.md) | Verified | Trace UI → typed Worker messages → engine → results; add a bounded, typed comparison-difference contract and verify end-to-end behavior. No server/auth service is needed. |
| [database-architecture](.agents/skills/database-architecture/SKILL.md) | Verified, adapted | Audit constraints and storage boundaries, rerun differential tests and benchmarks, preserve atomic mutations. Its PostgreSQL/Supabase/Neon, RLS and migration prescriptions are not applicable to this browser-only P0 engine. |
| [security-audit](.agents/skills/security-audit/SKILL.md) | Verified | Reproduce and fix LIKE backtracking, harden CSV export, test inert markup rendering, audit dependencies, and configure static response headers. See SECURITY.md. |
| [automated-testing](.agents/skills/automated-testing/SKILL.md) | Verified | Correct the unfinished swipe harness; add hostile-input, comparison, export, keyboard and multi-table graph tests; run the full suite against built assets. |
| [performance-optimization](.agents/skills/performance-optimization/SKILL.md) | Verified | Measure the LIKE adversary, maintain bounded virtualization and diff output, retain code-split editor/WASM, and refresh real engine/browser measurements. No invented field INP claims. |
| [deployment-qa](.agents/skills/deployment-qa/SKILL.md) | Verified | Add repeatable quality-gate CI, run a production preview with the deployment headers, verify packaged Worker/WASM, document rollback and release gaps. No deployment performed. |

“Confirm scope” in these skill files was satisfied by the user's explicit VELA-only instruction and inspection of this existing repository; it did not require another permission question. User instructions take precedence over generic guidance. Adding Supabase, Neon, authentication, a remote database, animation frameworks, or a new UI framework would contradict this project's architecture and was not done.

## Ongoing workflow

- Keep project rules, tier order, strict types, Bahasa Melayu UI, and engine isolation in AGENTS.md.
- Read the relevant local SKILL.md when beginning that category of work; use the evidence checklist, not a blanket rewrite.
- Preserve upstream skill files. Update only after reviewing new content, then intentionally update the locked blob hashes and run both validators.
- Use unit tests for semantics, differential tests for SQL compatibility, actual-browser tests for UI/Worker boundaries, and production-preview tests for packaged assets and headers.
- Finish and verify P0 before implementing physical indexes in P1. No new agents were spawned in this continuation, consistent with the latest work-alone instruction.
- Production deployment remains a separate approval-dependent action. Local build, preview, CI configuration and verification are authorized development work.
