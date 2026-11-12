"""Verify exact upstream Git blob hashes, without executing skill instructions."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / '.agents/skills.lock.json').read_text())
for skill in manifest['skills']:
    data = (root / skill['path']).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if digest != skill['gitBlobSha']:
        raise SystemExit(f"FAIL: source changed: {skill['name']}")
print(f"PASS: {len(manifest['skills'])} exact upstream Git blob hashes")
