---
name: deployment-qa
description: Verify GitHub Actions and Vercel release readiness.
---

# deployment-qa

## When to use
Use when the user requests work aligned with this skill. Confirm scope and inspect the repository before editing.

## Workflow
1. Inspect build scripts, env variable requirements, migrations, preview deployment and production configuration.
2. run lint, typecheck, tests and build.
3. verify routes, headers, auth, accessibility and rollback.
4. do not deploy without authorization.

## Deliverables
Provide checklist, verified commands, environment gaps, release decision and rollback steps.

## Quality gates
- Preserve existing behavior unless explicitly approved.
- Do not claim tests passed unless actually executed.
- Never expose secrets or modify production without approval.
- Record limitations, risks, and verification evidence.
