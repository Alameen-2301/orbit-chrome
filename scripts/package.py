from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root.parent / 'orbit-chrome-extension.zip'
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file() and not any(part in {'node_modules', '.git', '__pycache__', 'test-results', 'playwright-report'} for part in path.relative_to(root).parts):
            archive.write(path, Path('orbit-chrome') / path.relative_to(root))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'orbit-chrome/extension/manifest.json' in archive.namelist()
print(output)
