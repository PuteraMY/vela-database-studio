# Skill source and license boundaries

Rechecked against the shared PuteraMY repository and original vendor files on 2026-11-12 after the user announced its source migration.

- `skills/frontend-design/` is the complete two-file folder from [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design): original `SKILL.md` plus its Apache-2.0 `LICENSE.txt`. The entrypoint also matches the updated PuteraMY mirror byte-for-byte. Both files are hash-locked.
- The seven other original names remain unchanged custom guides in the shared repository. They are retained for provenance/continuity, **not represented as official vendor skills**. The shared repository's OFFICIAL-SOURCES-AUDIT.md explicitly marks them for future replacement. Do not use their existence as proof of a tool or plugin installation.
- The existing `skills/LICENSE` is the original PuteraMY MIT notice retained for the legacy material. It does not relicense Anthropic's folder or imply one license covers the entire evolving upstream collection.
- No third-party support scripts are executed by installing these text files. Frontend-design's only local dependency reference is its included license; the inspected original folder has no scripts/assets. Automatic runtime discovery remains unverified: the executor catalog is empty.

`skills.lock.json` records per-file source URLs, Git blob hashes, classification and support-file inventory. `npm run skills:verify` checks structure, complete selected vendor-folder inventory and exact bytes. The local validator was adapted because the old shared validator still assumes custom-guide headings and would reject an unchanged official frontend skill with its license field.

Do not edit vendor originals to satisfy a validator. Review changes and update source metadata deliberately. The eight-name audit here does not certify every other skill or plugin in the shared repository. No shared-repository file was modified.
