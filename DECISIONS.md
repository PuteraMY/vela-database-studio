# Decisions

- 2026-11-09: Start a new repository at /workspace; work alone as requested.
- P0 uses row arrays and a catalog of index definitions. Physical page storage and actual B+trees belong to P1; the studio must label those as unavailable until implemented.
- SQL is case-insensitive for identifiers; string values preserve case. NULL follows SQL three-valued logic. NULL sorts first ascending and last descending (SQLite defaults). BOOLEAN is normalized to 0/1 at result boundaries for SQLite comparison.
- Constraints are validated on a candidate database state, then published atomically per statement, including foreign-key checks on UPDATE and DELETE. Multi-statement scripts keep previously successful statements if a later statement fails (no implicit transaction).
- Strict column types: INTEGER requires a finite integer, REAL a finite number, TEXT a string, BOOLEAN a boolean or 0/1. No implicit SQLite affinity conversions on storage. INTEGER division follows SQLite when both operands are integral.
- UI shell exposes later-tier inspectors with explicit availability messages. It must never show fabricated index, page, WAL, or transaction metrics.
