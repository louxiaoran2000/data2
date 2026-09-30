'use strict';

// ============ 共享小工具 ============

/** 键排序后的稳定序列化（用作值比较/去重的键） */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** 带类型的值键：避免 1 与 "1"、true 与 "true" 撞键 */
function valueKey(v) {
  if (v === null) return 'null:null';
  const t = Array.isArray(v) ? 'array' : typeof v;
  return t + ':' + (t === 'object' || t === 'array' ? stableStringify(v) : String(v));
}

/** 值的展示形式（截断超长文本，用于报告样例） */
function displayValue(v, max = 120) {
  const s = typeof v === 'string' ? v : stableStringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

module.exports = { stableStringify, valueKey, displayValue };
