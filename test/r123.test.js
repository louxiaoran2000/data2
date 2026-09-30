'use strict';

// R1 --unique / R2 --enum / R3 gzip 输入 的验收测试
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const BIN = path.join(__dirname, '..', 'bin', 'datalint.js');
const GOOD = path.join(__dirname, 'fixtures', 'good.jsonl');
const BAD = path.join(__dirname, 'fixtures', 'bad.jsonl');
const DUP_ID = path.join(__dirname, 'fixtures', 'dup-id.jsonl');
const ENUM = path.join(__dirname, 'fixtures', 'enum.jsonl');

let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datalint-r123-'));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

// ---------- R1：字段唯一性检查 ----------

test('R1：--unique 报重复值个数/涉及记录/行号样例', () => {
  const r = runCli([DUP_ID, '--unique', 'id', '-f', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);

  const u = report.uniqueness.id;
  assert.strictEqual(u.distinctValues, 3); // a/b/c
  assert.strictEqual(u.duplicateValues, 1); // 只有 "a"
  assert.strictEqual(u.involvedRecords, 3);
  assert.strictEqual(u.top.length, 1);
  assert.strictEqual(u.top[0].value, 'a');
  assert.strictEqual(u.top[0].count, 3);
  assert.deepStrictEqual(u.top[0].samples.map((s) => s.line), [1, 3, 5]);

  // 与"完全重复记录"口径互不混淆：fixture 各行 text 不同，整行重复为 0
  assert.strictEqual(report.summary.duplicateRecords, 0);
  assert.ok(report.issues.some((i) => i.code === 'FIELD_DUPLICATE' && i.field === 'id'));
});

test('R1：text 报告包含"字段唯一性"小节', () => {
  const r = runCli([DUP_ID, '--unique', 'id']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[字段唯一性\]/);
  assert.match(r.stdout, /"a"×3（行 1, 3, 5）/);
});

test('R1：--unique 用在 clean 模式报错，退出码 1', () => {
  const r = runCli(['clean', GOOD, '--unique', 'id', '--out-dir', path.join(tmp, 'x1')]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /仅 check 模式可用/);
});

// ---------- R2：枚举值校验 ----------

test('R2 check：--enum 报非法值个数与行号', () => {
  const r = runCli([ENUM, '--enum', 'category=open_qa,closed_qa', '-f', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);

  const e = report.enums.category;
  assert.deepStrictEqual(e.allowed, ['open_qa', 'closed_qa']);
  assert.strictEqual(e.invalidValues, 1);
  assert.strictEqual(e.invalidRecords, 1);
  assert.strictEqual(e.top[0].value, 'math');
  assert.deepStrictEqual(e.top[0].samples.map((s) => s.line), [2]);
  assert.ok(report.issues.some((i) => i.code === 'ENUM_VIOLATION' && i.field === 'category'));
});

test('R2 clean：非法枚举记录丢弃，原因 enum_violation', () => {
  const outDir = path.join(tmp, 'enum-out');
  const r = runCli(['clean', ENUM, '--enum', 'category=open_qa,closed_qa', '--out-dir', outDir]);
  assert.strictEqual(r.status, 0, r.stderr);

  const cleaned = fs.readFileSync(path.join(outDir, 'cleaned.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(cleaned.length, 2);

  const rejected = fs.readFileSync(path.join(outDir, 'rejected.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(rejected.length, 1);
  assert.deepStrictEqual(rejected[0]._reject, ['enum_violation']);
  assert.strictEqual(rejected[0]._source.line, 2);
  assert.strictEqual(rejected[0].data.category, 'math');

  const report = JSON.parse(fs.readFileSync(path.join(outDir, 'clean-report.json'), 'utf8'));
  assert.strictEqual(report.stats.kept, 2);
  assert.strictEqual(report.stats.dropped, 1);
  assert.strictEqual(report.stats.reasons.enum_violation, 1);
});

test('R2：--enum 格式错误报中文用法错误', () => {
  const r = runCli([ENUM, '--enum', 'category']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /--enum 格式应为/);
});

test('R2 口径一致：枚举对 trim 后值判定，check 与 clean 结论相同', () => {
  const WS = path.join(__dirname, 'fixtures', 'enum-ws.jsonl');
  const args = ['--enum', 'category=open_qa,closed_qa'];

  // check：只有第 3 行（math）和第 5 行（" math "）违规；
  // 第 2 行纯空白跳过（计入字段统计的空串），第 4 行 trim 后合法放行
  const cr = runCli([WS, ...args, '-f', 'json']);
  assert.strictEqual(cr.status, 0, cr.stderr);
  const report = JSON.parse(cr.stdout);
  const e = report.enums.category;
  assert.strictEqual(e.invalidValues, 1);
  assert.strictEqual(e.invalidRecords, 2);
  assert.deepStrictEqual(e.top[0].samples.map((s) => s.line), [3, 5]);
  assert.strictEqual(e.top[0].value, 'math'); // " math " 按 trim 后值归入 "math"
  assert.strictEqual(report.fields.find((f) => f.name === 'category').emptyStrings, 1);

  // clean：同样只丢第 3、5 行，结论与 check 一致
  const outDir = path.join(tmp, 'enum-ws-out');
  const r = runCli(['clean', WS, ...args, '--out-dir', outDir]);
  assert.strictEqual(r.status, 0, r.stderr);
  const cleanReport = JSON.parse(fs.readFileSync(path.join(outDir, 'clean-report.json'), 'utf8'));
  assert.strictEqual(cleanReport.stats.kept, 3);
  assert.strictEqual(cleanReport.stats.dropped, 2);
  assert.strictEqual(cleanReport.stats.reasons.enum_violation, 2);
  const rejectedLines = fs
    .readFileSync(path.join(outDir, 'rejected.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l)._source.line);
  assert.deepStrictEqual(rejectedLines, [3, 5]);
  // trim 修复生效：保留记录中 " closed_qa " → "closed_qa"，" " → ""
  const kept = fs.readFileSync(path.join(outDir, 'cleaned.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(kept[1].category, '');
  assert.strictEqual(kept[2].category, 'closed_qa');
});

// ---------- R3：gzip 输入自动识别 ----------

function makeGz(srcFile, name) {
  const gz = path.join(tmp, name);
  fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(srcFile)));
  return gz;
}

test('R3 check：.gz 与未压缩版本统计完全一致', () => {
  const gz = makeGz(BAD, 'bad.jsonl.gz');
  const plain = JSON.parse(runCli([BAD, '-f', 'json']).stdout);
  const zipped = JSON.parse(runCli([gz, '-f', 'json']).stdout);

  assert.deepStrictEqual(zipped.summary, plain.summary);
  assert.deepStrictEqual(zipped.fields, plain.fields);
  assert.deepStrictEqual(zipped.issues, plain.issues);
  // 行号指压缩包内逻辑行号
  assert.deepStrictEqual(
    zipped.parseErrorSamples.map((s) => s.line),
    plain.parseErrorSamples.map((s) => s.line)
  );
});

test('R3：按 magic bytes 识别，不依赖扩展名', () => {
  const noExt = makeGz(GOOD, 'data-bin'); // 无 .gz 扩展名的 gzip 文件
  const r = runCli([noExt, '-f', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).summary.validRecords, 3);
});

test('R3 clean：.gz 输入产物条数一致', () => {
  const gz = makeGz(BAD, 'bad2.jsonl.gz');
  const run = (input, dir) => {
    const r = runCli(['clean', input, '--required', 'text,label', '--out-dir', dir]);
    assert.strictEqual(r.status, 0, r.stderr);
    return JSON.parse(fs.readFileSync(path.join(dir, 'clean-report.json'), 'utf8'));
  };
  const a = run(BAD, path.join(tmp, 'gz-a'));
  const b = run(gz, path.join(tmp, 'gz-b'));
  assert.deepStrictEqual(b.stats, a.stats);
});
