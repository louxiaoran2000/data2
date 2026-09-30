import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, UsageError } from '../src/cli.js';

test('默认取值：format=text，encoding=utf8，require 为空', () => {
  const opts = parseArgs(['a.jsonl', 'b.jsonl']);
  assert.deepEqual(opts, {
    files: ['a.jsonl', 'b.jsonl'],
    format: 'text',
    encoding: 'utf8',
    require: [],
    help: false,
  });
});

test('--format 两种写法；非法取值报用法错误', () => {
  assert.equal(parseArgs(['--format', 'json', 'a']).format, 'json');
  assert.equal(parseArgs(['--format=json', 'a']).format, 'json');
  assert.throws(() => parseArgs(['--format', 'xml', 'a']), UsageError);
  assert.throws(() => parseArgs(['--format']), UsageError);
});

test('--require 可重复、去重，支持等号写法', () => {
  const opts = parseArgs(['--require', 'id', '--require=label', '--require', 'id', 'a']);
  assert.deepEqual(opts.require, ['id', 'label']);
  assert.throws(() => parseArgs(['--require']), UsageError);
  assert.throws(() => parseArgs(['--require=', 'a']), UsageError);
});

test('--encoding 白名单校验', () => {
  assert.equal(parseArgs(['--encoding', 'gbk', 'a']).encoding, 'gbk');
  assert.equal(parseArgs(['--encoding=utf8', 'a']).encoding, 'utf8');
  assert.throws(() => parseArgs(['--encoding', 'xyz', 'a']), UsageError);
});

test('未知选项与无参数均为用法错误；--help 允许无文件', () => {
  assert.throws(() => parseArgs(['--nope', 'a']), UsageError);
  assert.throws(() => parseArgs([]), UsageError);
  assert.equal(parseArgs(['--help']).help, true);
});
