'use strict';

// ============ 解析层：只负责"把一行字符串变成解析结果" ============
// 返回三种结果之一：
//   { kind: 'empty' }                          空行（仅空白）
//   { kind: 'error', message, snippet }        JSON 解析失败
//   { kind: 'record', value, isObject, raw }   解析成功

const SNIPPET_LEN = 80;

function parseLine(rawLine) {
  let raw = rawLine;
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 去掉 UTF-8 BOM
  const trimmed = raw.trim();

  if (trimmed === '') {
    return { kind: 'empty' };
  }
  try {
    const value = JSON.parse(trimmed);
    const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    return { kind: 'record', value, isObject, raw: trimmed };
  } catch (e) {
    return {
      kind: 'error',
      message: e.message,
      snippet: trimmed.length > SNIPPET_LEN ? trimmed.slice(0, SNIPPET_LEN) + '…' : trimmed,
    };
  }
}

module.exports = { parseLine };
