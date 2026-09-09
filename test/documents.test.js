import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSources, renderArtifacts } from '../src/documents.js';

async function sandbox(t) {
  // Realpath avoids macOS /var -> /private/var aliases in output containment tests.
  const { realpath } = await import('node:fs/promises');
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'wm-docs-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('native artifacts reopen, retain nested long input and typed spreadsheet cells', async t => {
  const root = await sandbox(t);
  const input = path.join(root, 'input');
  await mkdir(path.join(input, 'nested'), { recursive: true });
  const long = 'full source evidence\n'.repeat(10000) + 'LAST RECORD';
  await writeFile(path.join(input, 'nested', 'long.txt'), long);
  const outputs = await renderArtifacts(input, [
    { path: 'nested/narrative.docx', kind: 'docx', title: 'Narrative', paragraphs: ['Grant evidence 1234'], tables: [{ headers: ['Name', 'Amount'], rows: [['Program', 1234]] }] },
    { path: 'budget.xlsx', kind: 'xlsx', sheets: [{ name: 'Budget', headers: ['Name', 'Amount'], rows: [['Program', 1234], ['=UNTRUSTED()', 0]] }] },
    { path: 'packet.pdf', kind: 'pdf', title: 'Board packet', paragraphs: ['Verified revenue 1234'] },
    { path: 'ledger.tsv', kind: 'tsv', tables: [{ headers: ['Name', 'Hours'], rows: [['Alice', 2.5]] }] },
    { path: 'record.json', kind: 'json', data: { approved: true } },
  ]);
  assert.equal(outputs.length, 5);
  assert.ok(outputs.every(item => item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.equal((await readFile(path.join(input, 'packet.pdf'))).subarray(0, 4).toString(), '%PDF');
  const result = await readSources(input);
  assert.deepEqual(result.errors, []);
  assert.equal(result.sources.length, 6);
  assert.equal(result.sources.find(s => s.path.endsWith('long.txt')).text, long);
  assert.match(result.sources.find(s => s.kind === 'docx').text, /Grant evidence 1234/);
  assert.match(result.sources.find(s => s.kind === 'pdf').text, /Verified revenue 1234/);
  const sheet = result.sources.find(s => s.kind === 'xlsx');
  assert.equal(sheet.tables.sheets[0].rows[0][1], 1234);
  assert.ok(sheet.anchors.some(a => a.cell === 'B2'));
  assert.ok(result.sources.every(s => s.id && s.sha256 && s.anchors.length));
});

test('unsupported and corrupt input are explicit errors', async t => {
  const root = await sandbox(t);
  await writeFile(path.join(root, 'corrupt.pdf'), 'invalid PDF');
  await writeFile(path.join(root, 'bad.json'), '{oops');
  await writeFile(path.join(root, 'unknown.bin'), 'opaque');
  const result = await readSources(root);
  assert.equal(result.sources.length, 0);
  assert.equal(result.errors.length, 3);
  assert.ok(result.errors.every(error => error.path && error.error));
});

test('artifact traversal and symlink escapes are rejected before writing', async t => {
  const root = await sandbox(t);
  const output = path.join(root, 'out');
  await mkdir(output);
  await assert.rejects(renderArtifacts(output, [{ path: '../escape.md', kind: 'md', text: 'bad' }]), /within/);
  await symlink(root, path.join(output, 'linked'));
  await assert.rejects(renderArtifacts(output, [{ path: 'linked/escape.md', kind: 'md', text: 'bad' }]), /symlink/);
  await assert.rejects(renderArtifacts(output, [{ path: '/absolute.md', kind: 'md', text: 'bad' }]), /within/);
});

test('scanned PDF uses local OCR and records page provenance', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  try {
    await exec('tesseract', ['--version']);
    await exec('pdftoppm', ['-v']);
  } catch {
    t.skip('Local tesseract and pdftoppm are required for OCR integration');
    return;
  }
  const root = await sandbox(t);
  await exec(process.env.WM_PYTHON || 'python3', ['-c', `
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import sys
image = Image.new('RGB', (1600, 400), 'white')
draw = ImageDraw.Draw(image)
font = ImageFont.load_default(size=70)
draw.text((50, 100), 'VOLUNTEER HOURS 42', fill='black', font=font)
pdf = canvas.Canvas(sys.argv[1], pagesize=(800, 200))
pdf.drawImage(ImageReader(image), 0, 0, width=800, height=200)
pdf.save()
`, path.join(root, 'scanned.pdf')]);
  const result = await readSources(root);
  assert.deepEqual(result.errors, []);
  assert.match(result.sources[0].text, /VOLUNTEER HOURS 42/);
  assert.equal(result.sources[0].anchors[0].method, 'ocr');
  assert.equal(result.sources[0].anchors[0].page, 1);
});
