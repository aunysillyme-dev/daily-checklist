from pathlib import Path
root = Path(__file__).resolve().parents[1]
paths = [
    root / 'index.html',
    root / 'README.md',
    root / 'src/main.ts',
    root / 'src/google.ts',
    root / 'src/model.ts',
    root / 'src/storage.ts',
    root / 'src/style.css',
]
paths += sorted((root / 'tests').glob('*.ts'))
paths += [root / 'tests/brand_check.py']
missing = [str(path) for path in paths if not path.exists()]
assert not missing, missing
text = '\n'.join(path.read_text() for path in paths)
banned = [
    'tasks.googleapis.com',
    'googleapis.com/auth/tasks',
    'Google Tasks',
    'TASK_SCOPE',
    'encodeNotes',
    'decodeTask',
    'createGoogleTask',
    'updateGoogleTask',
    'googleId',
]
for item in banned:
    assert item not in text, item
main = (root / 'src/main.ts').read_text()
google = (root / 'src/google.ts').read_text()
html = (root / 'index.html').read_text()
assert 'Sign in with Google' in main
assert main.count('data-action="sign-in"') >= 1
assert 'https://www.googleapis.com/auth/calendar.readonly' in google
assert 'https://www.googleapis.com/calendar/' in google
assert 'tasks.googleapis.com' not in html
assert 'https://oauth2.googleapis.com' in html
assert 'https://accounts.google.com' in html
assert "style-src 'self' https://fonts.googleapis.com https://accounts.google.com" in html
assert 'unsafe-inline' not in html
print('PASS: calendar-only sign-in, no task connector')
