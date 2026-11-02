from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
root=Path(__file__).resolve().parents[1]
out=root.parent/'release'
out.mkdir(exist_ok=True)
archive=out/'QuantPilot-render.zip'
directories=['src','public','migrations','tests','docs','scripts','.github']
files=['package.json','package-lock.json','tsconfig.json','vitest.config.ts','render.yaml','compose.yaml','.env.example','.gitignore','README.md','VERIFICATION.md','Start QuantPilot.cmd']
selected=[root/p for p in files]
for directory in directories:
    selected.extend(p for p in (root/directory).rglob('*') if p.is_file() and '__pycache__' not in p.parts and not p.is_symlink())
with ZipFile(archive,'w',ZIP_DEFLATED) as z:
    for path in sorted(set(selected)):
        if not path.is_file():
            raise SystemExit('Missing release file: '+str(path))
        relative=path.relative_to(root)
        if any(part in {'.env','data','node_modules','.git','.venv'} for part in relative.parts):
            raise SystemExit('Disallowed release path')
        z.write(path,relative.as_posix())
print(f'Created {archive} ({len(selected)} files)')
print('SHA256 '+sha256(archive.read_bytes()).hexdigest())

