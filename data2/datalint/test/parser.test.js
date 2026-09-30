import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, REASONS } from '../src/parser.js';

test('合法对象行进入 records，行号从 1 开始', () => {
  const { records, errors } = parseLines(['{"a":1}', '{"b":null}']);
  assert.equal(records.length, 2);
  assert.equal(errors.length, 0);
  assert.equal(records[0].line, 1);
  assert.deepEqual(records[1].value, { b: null });
});

test('空行（含纯空白行）归类为"空行"', () => {
  const { records, errors } = parseLines(['', '   ', '{"a":1}']);
  assert.equal(records.length, 1);
  assert.deepEqual(
    errors.map((e) => [e.line, e.reason]),
    [
      [1, REASONS.EMPTY],
      [2, REASONS.EMPTY],
    ],
  );
});

test('JSON 语法错误归类', () => {
  const { errors } = parseLines(['{bad', '{"a":}']);
  assert.deepEqual(
    errors.map((e) => e.reason),
    [REASONS.SYNTAX, REASONS.SYNTAX],
  );
});

test('数组、null、数字、字符串归类为"非 JSON 对象"', () => {
  const { records, errors } = parseLines(['[1,2]', 'null', '42', '"str"', '{"ok":true}']);
  assert.equal(records.length, 1);
  assert.deepEqual(
    errors.map((e) => [e.line, e.reason]),
    [
      [1, REASONS.NOT_OBJECT],
      [2, REASONS.NOT_OBJECT],
      [3, REASONS.NOT_OBJECT],
      [4, REASONS.NOT_OBJECT],
    ],
  );
});
