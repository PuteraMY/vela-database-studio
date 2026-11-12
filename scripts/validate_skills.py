"""Validate local inventory without imposing custom headings on vendor originals.

Adapted from PuteraMY's earlier eight-guide validator. This is a static check,
not proof of Codex discovery, plugin installation, or vendor endorsement.
"""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
base = root / '.agents' / 'skills'
manifest = json.loads((root / '.agents/skills.lock.json').read_text())
expected = {skill['name'] for skill in manifest['skills']}
actual = {path.name for path in base.iterdir() if path.is_dir()}
assert len(expected) == len(manifest['skills']), 'Duplicate skill entries'
assert actual == expected, f'Skill folders differ: {actual ^ expected}'
official = 0
legacy = 0
for skill in manifest['skills']:
    name = skill['name']
    path = base / name / 'SKILL.md'
    assert path.is_file(), f'Missing {path}'
    content = path.read_text(encoding='utf-8')
    frontmatter = re.match(r'^---\n(.*?)\n---\n', content, re.DOTALL)
    assert frontmatter, f'Missing frontmatter: {name}'
    fields = frontmatter.group(1)
    assert re.search(r'^name: ' + re.escape(name) + r'$', fields, re.MULTILINE), f'Invalid name: {name}'
    assert re.search(r'^description: .+', fields, re.MULTILINE), f'Missing description: {name}'
    if skill['provenance'] == 'vendor-original':
        official += 1
        inventory = set(skill['upstreamFolderFiles'])
        local_files = {str(file.relative_to(path.parent)) for file in path.parent.rglob('*') if file.is_file()}
        assert local_files == inventory, f'Incomplete or unexpected vendor files: {name}'
        assert skill['license'] and skill['supportFiles'], f'Missing vendor license metadata: {name}'
    else:
        assert skill['provenance'] == 'legacy-custom-guide', f'Unclassified source: {name}'
        legacy += 1
        for section in ('## When to use', '## Workflow', '## Deliverables', '## Quality gates'):
            assert section in content, f'Missing {section}: {name}'
print(f'PASS: {len(expected)} local entries; {official} vendor-original folder, {legacy} legacy custom guides')
print('Runtime discovery and plugin installation are not validated by this script.')
