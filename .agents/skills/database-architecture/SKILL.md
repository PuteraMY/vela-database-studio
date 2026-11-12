---
name: database-architecture
description: Design reliable PostgreSQL schemas for Supabase or Neon.
---

# database-architecture

## When to use
Use when the user requests work aligned with this skill. Confirm scope and inspect the repository before editing.

## Workflow
1. Inspect schema and workload.
2. model constraints and indexes.
3. plan forward-only migrations with rollback.
4. enforce least privilege and RLS where applicable.
5. benchmark queries.
6. prevent secrets in client code.

## Deliverables
Provide schema changes, migration safety checks, EXPLAIN findings, backup and rollback guidance.

## Quality gates
- Preserve existing behavior unless explicitly approved.
- Do not claim tests passed unless actually executed.
- Never expose secrets or modify production without approval.
- Record limitations, risks, and verification evidence.
