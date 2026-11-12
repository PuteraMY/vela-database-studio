---
name: automated-testing
description: Build reliable tests across unit, integration and E2E levels.
---

# automated-testing

## When to use
Use when the user requests work aligned with this skill. Confirm scope and inspect the repository before editing.

## Workflow
1. Identify critical user journeys.
2. select suitable test layers.
3. create deterministic fixtures and mocks.
4. cover failures, boundaries, access control and accessibility.
5. run tests and investigate flakes.
6. keep CI repeatable.

## Deliverables
Provide test matrix, commands, pass/fail counts, gaps and reproducible failures.

## Quality gates
- Preserve existing behavior unless explicitly approved.
- Do not claim tests passed unless actually executed.
- Never expose secrets or modify production without approval.
- Record limitations, risks, and verification evidence.
