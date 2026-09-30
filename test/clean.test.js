'use strict';

// clean 子命令与 -o 落盘的验收测试
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'datalint.js');
const GOOD = path.join(__dirname, 'fixtures', 'good.jsonl');
const BAD = path.join(__dirname, 'fixtures', 'bad.jsonl');

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datalint-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').map(JSON.parse);

test('-o：报告写入文件，stdout 为空', () => {
  const out = path.join(tmp, 'report.json');
  const r = runCli([GOOD, '-f', 'json', '-o', out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '');
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(report.summary.validRecords, 3);
});

test('clean：定向清洗脏数据，产物齐全且统计正确', () => {
  const outDir = path.join(tmp, 'out');
  const r = runCli(['clean', BAD, '--required', 'text,label', '--min-len', '2', '--out-dir', outDir]);
  assert.strictEqual(r.status, 0, r.stderr);

  const cleanedPath = path.join(outDir, 'cleaned.jsonl');
  const rejectedPath = path.join(outDir, 'rejected.jsonl');
  const reportPath = path.join(outDir, 'clean-report.json');
  for (const p of [cleanedPath, rejectedPath, reportPath]) {
    assert.ok(fs.existsSync(p), `缺少产物 ${p}`);
  }

  // bad.jsonl 共 6 行：1 空行、1 解析错误、4 条记录（其中 1 重复、1 缺 label、1 text 是数字）
  const cleaned = readJsonl(cleanedPath);
  assert.strictEqual(cleaned.length, 1);
  assert.deepStrictEqual(cleaned[0], { text: 'ok', label: 'pos' });

  const rejected = readJsonl(rejectedPath);
  assert.strictEqual(rejected.length, 5);
  assert.ok(rejected.every((e) => Array.isArray(e._reject) && e._source.line > 0));

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.strictEqual(report.stats.lines, 6);
  assert.strictEqual(report.stats.kept, 1);
  assert.strictEqual(report.stats.dropped, 5);
  assert.deepStrictEqual(report.stats.reasons, {
    empty_line: 1,
    parse_error: 1,
    duplicate: 1,
    'missing_field:label': 1,
    'invalid_type:text': 1,
  });
});

test('clean：trim 修复生效', () => {
  const dirty = path.join(tmp, 'dirty.jsonl');
  fs.writeFileSync(dirty, '{"text": "  带空白  ", "label": "pos"}\n');
  const outDir = path.join(tmp, 'trim-out');
  const r = runCli(['clean', dirty, '--required', 'text', '--out-dir', outDir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const cleaned = readJsonl(path.join(outDir, 'cleaned.jsonl'));
  assert.strictEqual(cleaned[0].text, '带空白');
  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'clean-report.json'), 'utf8'));
  assert.strictEqual(report.stats.fixedTrim, 1);
});

test('clean 专属选项用在 check 模式：中文报错，退出码 1', () => {
  const r = runCli([GOOD, '--required', 'text']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /仅 clean 模式可用/);
});

test('clean：文件不存在，退出码 2', () => {
  const r = runCli(['clean', '不存在.jsonl', '--out-dir', path.join(tmp, 'x')]);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /文件不存在或无法访问/);
});
