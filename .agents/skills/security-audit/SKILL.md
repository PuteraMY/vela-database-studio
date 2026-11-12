---
name: security-audit
description: Identify and prioritize web application security risks.
---

# security-audit

## When to use
Use when the user requests work aligned with this skill. Confirm scope and inspect the repository before editing.

## Workflow
1. Map trust boundaries and roles.
2. review authn, authz, RLS, input validation, XSS, CSRF, SSRF, secrets, dependencies and rate limiting.
3. reproduce safely without touching live user data.
4. rank by impact and likelihood.

## Deliverables
Provide evidence-based findings, severity, remediation, regression tests and unresolved risks.

## Quality gates
- Preserve existing behavior unless explicitly approved.
- Do not claim tests passed unless actually executed.
- Never expose secrets or modify production without approval.
- Record limitations, risks, and verification evidence.
