import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../src/report.js';

function makeReport(fieldCounts) {
  return {
    files: [],
    totals: { totalLines: 0, validLines: 0, invalidLines: 0, missingRequired: {} },
    fieldCounts,
    errors: [],
  };
}

test('D1 回归：类整数字段名在 json 中仍按出现次数降序', () => {
  const fieldCounts = new Map([
    ['10', 2],
    ['2', 1],
    ['x', 1],
  ]);
  const parsed = JSON.parse(renderJson(makeReport(fieldCounts)));
  // 有序数组结构：顺序必须与次数降序一致（10, 2, x），不被 JS 对象的整数键重排破坏
  assert.deepEqual(parsed.fieldCounts, [
    { field: '10', count: 2 },
    { field: '2', count: 1 },
    { field: 'x', count: 1 },
  ]);
});

test('json 字段统计为空时输出空数组', () => {
  const parsed = JSON.parse(renderJson(makeReport(new Map())));
  assert.deepEqual(parsed.fieldCounts, []);
});
