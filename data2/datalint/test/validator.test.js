import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRequired } from '../src/validator.js';

test('收集每个必填字段的缺失行号', () => {
  const records = [
    { line: 1, value: { id: 1, label: 'a' } },
    { line: 2, value: { id: 2 } },
    { line: 5, value: {} },
  ];
  const missing = checkRequired(records, ['id', 'label']);
  assert.deepEqual(missing.get('id'), [5]);
  assert.deepEqual(missing.get('label'), [2, 5]);
});

test('字段值为 null 视为存在', () => {
  const records = [{ line: 1, value: { id: 1, label: null } }];
  const missing = checkRequired(records, ['label']);
  assert.deepEqual(missing.get('label'), []);
});

test('未提供必填字段时返回空 Map', () => {
  const missing = checkRequired([{ line: 1, value: {} }], []);
  assert.equal(missing.size, 0);
});
