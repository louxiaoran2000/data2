import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLines, FileReadError } from '../src/reader.js';

const GBK_FIXTURE = fileURLToPath(new URL('../examples/data-gbk.jsonl', import.meta.url));

function writeTmp(content) {
  const dir = mkdtempSync(join(tmpdir(), 'datalint-'));
  const path = join(dir, 'case.jsonl');
  writeFileSync(path, content);
  return path;
}

test('UTF-8 BOM 被去除，不影响首行', () => {
  assert.deepEqual(readLines(writeTmp('﻿{"a":1}\n{"a":2}\n')), ['{"a":1}', '{"a":2}']);
});

test('兼容 CRLF 换行', () => {
  assert.deepEqual(readLines(writeTmp('{"a":1}\r\n{"a":2}\r\n')), ['{"a":1}', '{"a":2}']);
});

test('文件结尾换行不产生空行；中间空行保留', () => {
  assert.deepEqual(readLines(writeTmp('{"a":1}\n')), ['{"a":1}']);
  assert.deepEqual(readLines(writeTmp('{"a":1}\n\n{"a":2}\n')), ['{"a":1}', '', '{"a":2}']);
});

test('空文件返回空数组', () => {
  assert.deepEqual(readLines(writeTmp('')), []);
});

test('文件不存在抛出 FileReadError，含中文原因', () => {
  assert.throws(() => readLines('/tmp/datalint-一定不存在.jsonl'), (err) => {
    assert.ok(err instanceof FileReadError);
    assert.match(err.message, /文件不存在/);
    return true;
  });
});

test('GBK 编码解码正确（中文无乱码）', () => {
  const lines = readLines(GBK_FIXTURE, 'gbk');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /你好，世界/);
  assert.match(lines[1], /编码测试/);
});

test('误用 utf8 读取 GBK 文件不抛异常（非致命替换）', () => {
  const lines = readLines(GBK_FIXTURE, 'utf8');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /�/); // 替换字符 U+FFFD
});
