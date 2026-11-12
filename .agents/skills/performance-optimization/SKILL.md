---
name: performance-optimization
description: Improve real user performance without sacrificing usability.
---

# performance-optimization

## When to use
Use when the user requests work aligned with this skill. Confirm scope and inspect the repository before editing.

## Workflow
1. Establish baseline for LCP, INP and CLS.
2. profile network, bundles, rendering and database queries.
3. prioritize highest-impact bottlenecks.
4. optimize images and caching.
5. compare before/after and test regressions.

## Deliverables
Provide baseline, measurements, changes, tradeoffs and monitoring suggestions.

## Quality gates
- Preserve existing behavior unless explicitly approved.
- Do not claim tests passed unless actually executed.
- Never expose secrets or modify production without approval.
- Record limitations, risks, and verification evidence.
