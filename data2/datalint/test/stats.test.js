import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFile, countFields } from '../src/stats.js';

test('summarizeFile 输出行级汇总与非法行明细', () => {
  const lines = ['{"a":1}', 'bad', ''];
  const parseResult = {
    records: [{ line: 1, value: { a: 1 } }],
    errors: [
      { line: 2, reason: 'JSON 语法错误' },
      { line: 3, reason: '空行' },
    ],
  };
  const summary = summarizeFile('f.jsonl', lines, parseResult);
  assert.deepEqual(summary, {
    file: 'f.jsonl',
    totalLines: 3,
    validLines: 1,
    invalidLines: 2,
    invalidLineNumbers: [2, 3],
    invalidLineDetails: [
      { line: 2, reason: 'JSON 语法错误' },
      { line: 3, reason: '空行' },
    ],
  });
});

test('countFields 按记录计数，同记录同字段只计一次，可跨记录合并', () => {
  const records = [
    { line: 1, value: { id: 1, label: 'a' } },
    { line: 2, value: { id: 2, score: 0.5 } },
    { line: 3, value: { label: null } },
  ];
  const counts = countFields(records);
  assert.equal(counts.get('id'), 2);
  assert.equal(counts.get('label'), 2); // null 值字段也算出现
  assert.equal(counts.get('score'), 1);
  assert.equal(counts.size, 3);
});
