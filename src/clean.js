'use strict';

// ============ 清洗层：吃解析结果，按规则给出 保留/修复/丢弃 ============
// 规则（面向 SFT 训练数据）：
//   丢弃：空行、解析失败、非对象记录、缺必填字段、必填字段类型非字符串、
//         必填字段空串、必填字段长度越界（min/max）、枚举值非法（--enum）、
//         规范化后完全重复
//   修复：所有字符串字段去首尾空白（trim）
const { stableStringify } = require('./util');

const round4 = (x) => Math.round(x * 10000) / 10000;

function createCleaner(options = {}) {
  const required = options.required || [];
  const minLen = options.minLen ?? null;
  const maxLen = options.maxLen ?? null;
  const enums = options.enums || {}; // { 字段: Set(允许值) }，只判定非空字符串

  const seen = new Set();
  const stats = { lines: 0, kept: 0, dropped: 0, fixedTrim: 0, reasons: {} };

  function bump(reason) {
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
  }

  return {
    /**
     * @returns
     *   { keep: true, record }                清洗后保留的记录
     *   { keep: false, entry }                写入 rejected.jsonl 的条目
     */
    process(parsed, file, lineNo) {
      stats.lines++;

      const drop = (reasons, data) => {
        stats.dropped++;
        for (const r of reasons) bump(r);
        return { keep: false, entry: { _reject: reasons, _source: { file, line: lineNo }, data } };
      };

      if (parsed.kind === 'empty') return drop(['empty_line'], null);
      if (parsed.kind === 'error') return drop(['parse_error'], parsed.snippet);
      if (!parsed.isObject) return drop(['non_object'], parsed.value);

      // 修复：字符串字段 trim
      const record = {};
      let trimmed = 0;
      for (const [k, v] of Object.entries(parsed.value)) {
        if (typeof v === 'string') {
          const t = v.trim();
          if (t !== v) trimmed++;
          record[k] = t;
        } else {
          record[k] = v;
        }
      }

      // 规则校验
      const reasons = [];
      for (const f of required) {
        if (!(f in record)) {
          reasons.push(`missing_field:${f}`);
        } else if (record[f] === null) {
          reasons.push(`empty_field:${f}`);
        } else if (typeof record[f] !== 'string') {
          reasons.push(`invalid_type:${f}`);
        } else {
          if (record[f] === '') reasons.push(`empty_field:${f}`);
          else if (minLen !== null && record[f].length < minLen) reasons.push(`too_short:${f}`);
          else if (maxLen !== null && record[f].length > maxLen) reasons.push(`too_long:${f}`);
        }
      }
      // 枚举校验：对 trim 后的值判定（record 已完成 trim 修复，'' 即 trim 后为空，跳过），
      // 非法记一次 enum_violation——与 check 的判定口径一致
      for (const [f, allowed] of Object.entries(enums)) {
        const v = record[f];
        if (typeof v === 'string' && v !== '' && !allowed.has(v)) {
          reasons.push('enum_violation');
          break; // 一条记录只记一次
        }
      }
      const key = stableStringify(record);
      if (seen.has(key)) {
        reasons.push('duplicate');
      } else {
        seen.add(key);
      }

      if (reasons.length > 0) return drop(reasons, record);

      stats.kept++;
      stats.fixedTrim += trimmed;
      return { keep: true, record };
    },

    finish(extra = {}) {
      return {
        tool: 'datalint',
        version: require('../package.json').version,
        generatedAt: new Date().toISOString(),
        mode: 'clean',
        ...extra,
        rules: {
          required,
          minLen,
          maxLen,
          enums: Object.fromEntries(Object.entries(enums).map(([f, s]) => [f, [...s]])),
          dedup: '规范化整行（键排序 + trim 后比较）',
          fix: '字符串字段 trim',
        },
        stats: {
          ...stats,
          dropRate: stats.lines > 0 ? round4(stats.dropped / stats.lines) : 0,
        },
      };
    },
  };
}

module.exports = { createCleaner };
