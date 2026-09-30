'use strict';

// 验收测试：安装后可跑通、错误场景退出码非 0、字段异常可检出
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'datalint.js');
const GOOD = path.join(__dirname, 'fixtures', 'good.jsonl');
const BAD = path.join(__dirname, 'fixtures', 'bad.jsonl');

function runCli(args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

test('不传参数：中文报错，退出码 1', () => {
  const r = runCli([]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /请提供至少一个 JSONL 文件路径/);
});

test('未知选项：中文报错，退出码 1', () => {
  const r = runCli(['--nope', GOOD]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /未知选项/);
});

test('文件不存在：中文报错，退出码 2', () => {
  const r = runCli(['不存在.jsonl']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /文件不存在或无法访问/);
});

test('干净文件：退出码 0，json 输出结构正确', () => {
  const r = runCli([GOOD, '--format', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.summary.validRecords, 3);
  assert.strictEqual(report.summary.parseErrors, 0);
  assert.strictEqual(report.summary.duplicateRecords, 0);
  assert.deepStrictEqual(report.issues, []);
  const text = report.fields.find((f) => f.name === 'text');
  assert.strictEqual(text.presenceRate, 1);
  assert.strictEqual(text.emptyStrings, 1); // 第三行 text 是空串
  assert.strictEqual(text.length.max, 11);
});

test('脏文件：解析错误/重复/类型不一致/缺字段全部检出', () => {
  const r = runCli([BAD, '--format', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.summary.totalLines, 6);
  assert.strictEqual(report.summary.emptyLines, 1);
  assert.strictEqual(report.summary.parseErrors, 1);
  assert.strictEqual(report.summary.validRecords, 4);
  assert.strictEqual(report.summary.duplicateRecords, 1);
  assert.strictEqual(report.parseErrorSamples.length, 1);
  assert.strictEqual(report.parseErrorSamples[0].line, 2);

  const text = report.fields.find((f) => f.name === 'text');
  assert.strictEqual(text.typeConsistent, false); // string×3 + number×1
  assert.strictEqual(text.types.number, 1);

  const label = report.fields.find((f) => f.name === 'label');
  assert.strictEqual(label.missing, 1);

  const codes = report.issues.map((i) => i.code);
  for (const c of ['PARSE_ERROR', 'TYPE_INCONSISTENT', 'FIELD_MISSING', 'DUPLICATE']) {
    assert.ok(codes.includes(c), `缺少问题类型 ${c}`);
  }
});

test('--strict：有解析错误时退出码 3', () => {
  const r = runCli([BAD, '--strict']);
  assert.strictEqual(r.status, 3);
});

test('text 输出：包含各分区表格', () => {
  const r = runCli([BAD]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[概览\]/);
  assert.match(r.stdout, /\[字段统计\]/);
  assert.match(r.stdout, /\[解析错误样例\]/);
  assert.match(r.stdout, /\[问题汇总\]/);
});

test('多文件聚合 + 跨文件去重', () => {
  const COPY = path.join(__dirname, 'fixtures', 'good-copy.jsonl'); // 内容与 good.jsonl 相同
  const r = runCli([GOOD, COPY, '--format', 'json']);
  assert.strictEqual(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.strictEqual(report.summary.files, 2);
  assert.strictEqual(report.summary.validRecords, 6);
  assert.strictEqual(report.summary.duplicateRecords, 3); // 3 行在两个文件中各出现一次
  assert.strictEqual(report.files.length, 2);
});

test('--help 与 --version：退出码 0', () => {
  assert.strictEqual(runCli(['--help']).status, 0);
  assert.strictEqual(runCli(['--version']).status, 0);
});
