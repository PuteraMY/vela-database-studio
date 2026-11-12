"""Verify exact upstream Git blob hashes, without executing skill instructions."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / '.agents/skills.lock.json').read_text())
support_count = 0
for skill in manifest['skills']:
    files = [skill, *skill['supportFiles']]
    support_count += len(skill['supportFiles'])
    for source in files:
        path = root / source['path']
        if not path.is_file():
            raise SystemExit(f"FAIL: missing locked source: {source['path']}")
        data = path.read_bytes()
        digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if digest != source['gitBlobSha']:
            raise SystemExit(f"FAIL: source changed: {source['path']}")
print(f"PASS: {len(manifest['skills'])} entrypoint hashes + {support_count} support-file hashes")
print('A matching legacy-guide hash does not establish official vendor provenance.')
