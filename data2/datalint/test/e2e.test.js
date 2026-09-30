import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, ['bin/datalint.js', ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('双文件运行 exit 0，输出合并统计与非法行分类', () => {
  const res = run(['examples/users.jsonl', 'examples/extra.jsonl']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /总行数：11/);
  assert.match(res.stdout, /JSON 语法错误：第 4 行/);
  assert.match(res.stdout, /非 JSON 对象：第 6 行/);
});

test('json 报告含 invalidLineNumbers 与 invalidLineDetails，errors 为空数组', () => {
  const res = run(['--format', 'json', 'examples/users.jsonl']);
  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  assert.deepEqual(report.files[0].invalidLineNumbers, [4, 6]);
  assert.deepEqual(report.files[0].invalidLineDetails, [
    { line: 4, reason: 'JSON 语法错误' },
    { line: 6, reason: '非 JSON 对象' },
  ]);
  assert.deepEqual(report.files[0].missingRequired, {});
  assert.deepEqual(report.errors, []);
});

test('--require 校验：缺失行号正确且不影响退出码', () => {
  const res = run(['--format', 'json', '--require', 'id', '--require', 'label', 'examples/users.jsonl', 'examples/extra.jsonl']);
  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  assert.deepEqual(report.files[0].missingRequired, { id: [], label: [] });
  assert.deepEqual(report.files[1].missingRequired, { id: [], label: [1, 2] });
  assert.deepEqual(report.totals.missingRequired, { id: 0, label: 2 });
});

test('读取失败容错：正常文件报告完整、含失败区块、exit 1', () => {
  const res = run(['examples/users.jsonl', 'not-exist.jsonl', 'examples/extra.jsonl']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /总行数：8/); // users.jsonl 报告仍在
  assert.match(res.stdout, /总行数：3/); // extra.jsonl 报告仍在
  assert.match(res.stdout, /读取失败的文件/);
  assert.match(res.stdout, /not-exist\.jsonl/);

  const asJson = JSON.parse(run(['--format', 'json', 'not-exist.jsonl']).stdout);
  assert.deepEqual(asJson.files, []);
  assert.equal(asJson.errors.length, 1);
  assert.match(asJson.errors[0].reason, /文件不存在/);
});

test('无参数 exit 2 且输出中文用法错误', () => {
  const res = run([]);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /未提供任何输入文件/);
});

test('GBK 示例：统计数字正确', () => {
  const res = run(['--encoding', 'gbk', 'examples/data-gbk.jsonl']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /总行数：3/);
  assert.match(res.stdout, /合法行数：2/);
  assert.match(res.stdout, /非法行数：1/);
});

test('非法 --encoding 取值 exit 2', () => {
  const res = run(['--encoding', 'xyz', 'examples/users.jsonl']);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /只支持 utf8 或 gbk/);
});

test('D2 回归：--require __proto__ 时 totals 与逐文件合计一致', () => {
  const res = run(['--format', 'json', '--require', '__proto__', 'examples/extra.jsonl']);
  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  // 期望值用 JSON.parse 构造：对象字面量 {"__proto__": ...} 会被 JS 特殊处理而无法表达该键
  assert.deepEqual(report.files[0].missingRequired, JSON.parse('{"__proto__": [1, 2]}'));
  assert.deepEqual(report.totals.missingRequired, JSON.parse('{"__proto__": 2}'));
});
