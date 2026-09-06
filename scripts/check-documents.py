"""Read-only environment check; no package installs or model calls."""
import importlib.metadata
import json
import shutil
packages = ['python-docx', 'openpyxl', 'reportlab', 'pypdf', 'Pillow']
versions = {}
for package in packages:
    try:
        versions[package] = importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        versions[package] = None
print(json.dumps({'packages': versions, 'ocr': {tool: bool(shutil.which(tool)) for tool in ['pdftoppm', 'tesseract']}, 'ready': all(versions.values())}))
