from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
base = root / '.agents' / 'skills'
expected = {'frontend-design','design-system','fullstack-development','database-architecture','security-audit','automated-testing','performance-optimization','deployment-qa'}
actual = {p.name for p in base.iterdir() if p.is_dir()}
assert actual == expected, f'Skill folders differ: {actual ^ expected}'
for name in sorted(expected):
    path = base / name / 'SKILL.md'
    assert path.is_file(), f'Missing {path}'
    content = path.read_text(encoding='utf-8')
    assert re.search(r'^---\nname: '+re.escape(name)+r'\ndescription: .+\n---\n',content), f'Invalid frontmatter: {name}'
    for section in ('## When to use','## Workflow','## Deliverables','## Quality gates'):
        assert section in content, f'Missing {section}: {name}'
print('PASS: 8 skills with valid structure and required sections')
