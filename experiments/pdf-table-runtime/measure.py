"""Windows x64 pdfplumber payload size pilot; never changes the application runtime."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--seven-zip', required=True)
parser.add_argument('--pdfplumber-version', default='0.11.10')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
work = root / 'data' / 'pdf-table-runtime' / time.strftime('%Y%m%d-%H%M%S')
payload = work / 'payload'
payload.mkdir(parents=True)

def fetch(url):
    with urllib.request.urlopen(url, timeout=90) as response:
        return response.read()

def write_json(file, data):
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

def run(command, name, **kwargs):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding='utf-8', errors='replace', timeout=600,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), **kwargs)
    (work / (name + '.log')).write_text(result.stdout, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(f'{name} failed; inspect {work / (name + ".log")}')
    return result.stdout

version = '3.13.17'
url = f'https://www.python.org/ftp/python/{version}/python-{version}-embed-amd64.zip'
archive = work / 'python-embed.zip'
archive.write_bytes(fetch(url))
with zipfile.ZipFile(archive) as z:
    z.extractall(payload)
base_bytes = sum(p.stat().st_size for p in payload.rglob('*') if p.is_file())
metadata = json.loads(fetch(f'https://pypi.org/pypi/pdfplumber/{args.pdfplumber_version}/json'))
pdf_version = metadata['info']['version']
target = payload / 'Lib' / 'site-packages'
run([sys.executable, '-I', '-m', 'pip', '--isolated', 'install', '--index-url', 'https://pypi.org/simple',
     '--disable-pip-version-check', '--only-binary=:all:', '--platform', 'win_amd64',
     '--python-version', '3.13', '--implementation', 'cp', '--abi', 'cp313',
     '--no-compile', '--target', str(target), '--report', str(work / 'pip-report.json'),
     'pdfplumber==' + pdf_version], 'install')
# The embeddable interpreter uses only explicit local paths; no global site or pip.
(payload / 'python313._pth').write_text('python313.zip\n.\nLib/site-packages\n', encoding='ascii')
reader = payload / 'read_tables.py'
reader.write_text('''import json, sys, pdfplumber
with pdfplumber.open(sys.argv[1]) as pdf:
    print(json.dumps({"tables":pdf.pages[0].extract_tables(),"python":sys.version,"paths":sys.path},ensure_ascii=False))
''', encoding='utf-8')
# Synthetic PDF with a two-column ruled table. No generator dependency in payload.
stream = b'0 0 0 RG 1 w 50 650 200 80 re S 50 690 m 250 690 l S 150 650 m 150 730 l S\nBT /F1 12 Tf 60 705 Td (Item) Tj 100 0 Td (Amount) Tj -100 -40 Td (Test) Tj 100 0 Td (123.45) Tj ET'
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
           b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
           b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
           b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
body = b'%PDF-1.4\n'; offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(body)); body += str(i).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
start = len(body)
body += b'xref\n0 6\n0000000000 65535 f \n' + b''.join(f'{n:010d} 00000 n \n'.encode() for n in offsets[1:])
body += b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(start).encode() + b'\n%%EOF\n'
fixture = work / 'synthetic-table.pdf'; fixture.write_bytes(body)
clean_env = {k:v for k,v in os.environ.items() if not k.upper().startswith(('PYTHON', 'PIP', 'VIRTUAL_ENV', 'CONDA'))}
output = run([str(payload / 'python.exe'), '-I', '-B', str(reader), str(fixture)], 'smoke', env=clean_env)
smoke = json.loads(output)
assert smoke['tables'] == [[['Item', 'Amount'], ['Test', '123.45']]], smoke['tables']
assert all(str(payload).lower() in p.lower() for p in smoke['paths']), smoke['paths']
groups = []
for p in sorted(payload.iterdir()):
    size = sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) if p.is_dir() else p.stat().st_size
    groups.append({'name':p.name,'bytes':size})
deps = [{'name':p.name,'bytes':sum(f.stat().st_size for f in p.rglob('*') if f.is_file())} for p in target.iterdir()]
total = sum(p.stat().st_size for p in payload.rglob('*') if p.is_file())
compressed = {}
for kind, options in [('7z', ['-t7z', '-mx=9', '-m0=LZMA2', '-ms=on']), ('zip', ['-tzip', '-mx=9'])]:
    output_file = work / ('pdf-table-runtime.' + kind)
    run([args.seven_zip, 'a', *options, str(output_file), '.\\*'], 'compress-' + kind, cwd=payload)
    compressed[kind] = output_file.stat().st_size
report = json.loads((work / 'pip-report.json').read_text(encoding='utf-8'))
receipt = {'status':'passed', 'platform':'Windows x64', 'python':version, 'pdfplumber':pdf_version,
           'pythonDownload':{'url':url,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},
           'pythonExtractedBytes':base_bytes, 'totalPayloadBytes':total, 'compressedBytes':compressed,
           'topLevel':groups,'dependencies':sorted(deps,key=lambda d:d['bytes'],reverse=True),
           'packages':[{'name':item['metadata']['name'],'version':item['metadata']['version'],'download':item['download_info']} for item in report['install']],
           'smoke':smoke, 'work':str(work), 'actualInstallerDeltaMeasured':False}
write_json(work / 'receipt.json', receipt)
print(json.dumps({k:receipt[k] for k in ['status','platform','python','pdfplumber','pythonDownload','pythonExtractedBytes','totalPayloadBytes','compressedBytes','work']},ensure_ascii=False))
