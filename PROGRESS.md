# Progress

- Repository rules created and git initialized.
- P0: in progress; engine, studio and validation pending.
- P1: not started.
- P2: not started.
- P3: not started.
- No test/build/performance claims yet.

## Engine P0 milestone
- Implemented dependency-free tokenizer, parser, expression evaluator, atomic row storage/constraints, and pull-based operators.
- 203 Vitest tests passed. Typecheck and lint passed with zero warnings after correcting hook dependencies.
- Fixed worker build failure by setting ES module worker output (SQLite comparison is dynamically imported).
- Worker-backed initial playground and three datasets built. Full studio design and browser verification still pending; P0 tier is NOT marked complete yet.

## P0 engine review fixes
- Independent review reproduced 18 semantic/validation failures. Root fixed REAL affinity, comparison precedence, alias binding, wildcard/ordinal validation, ASCII-only LIKE case folding with Unicode characters, boolean IS predicates, and negative SUBSTR bounds.
- 221/221 unit tests now pass, including all 18 regressions; typecheck/lint/build passed. Build split into editor/react/app chunks without size warnings.
- Initial differential evidence: curated 100/100, fuzz 4922/5000. Repeat run after fixes pending; initial result is not the final match rate.
