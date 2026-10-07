import hashlib
from pathlib import Path
root = Path(__file__).resolve().parents[1]
css = (root / 'src/style.css').read_text()
for value in ['#FAF5EE', '#0B1121', '#FD8D0C', '#2A9D8F', 'Inter']:
    assert value in css, value
asset = root / 'public/brand-mark.png'
assert asset.is_file()
digest = hashlib.sha256(asset.read_bytes()).hexdigest()
assert digest == '205e309720133440843530d8f2000c88d429fa19df47994dcba3d8fbfed40a13', digest
print('PASS: website brand colors, Inter and actual lighthouse asset')
