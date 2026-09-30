'use strict';

// ============ 统计层：吃解析结果，攒出"报告对象" ============
const { valueKey, displayValue, stableStringify } = require('./util');

/** 值的 JSON 类型（区分 null / array / object） */
function jtype(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string | number | boolean | object
}

const round4 = (x) => Math.round(x * 10000) / 10000;
const pctNum = (x) => Math.round(x * 10000) / 100; // 保留两位小数，如 11.11
const LINE_SAMPLE_CAP = 5; // 每个取值的行号样例上限

/** 取值计数器：--unique / --enum 共用的"值 → 次数 + 行号样例"结构 */
class ValueCounter {
  constructor() {
    this.map = new Map(); // valueKey -> { value, count, samples: [{file, line}] }
  }

  add(rawValue, file, line) {
    const key = valueKey(rawValue);
    if (!this.map.has(key)) {
      this.map.set(key, { value: displayValue(rawValue), count: 0, samples: [] });
    }
    const e = this.map.get(key);
    e.count++;
    if (e.samples.length < LINE_SAMPLE_CAP) e.samples.push({ file, line });
  }

  /** 按次数降序取前 n 个 */
  top(n) {
    return [...this.map.values()]
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, n);
  }
}

class FieldStat {
  constructor(name) {
    this.name = name;
    this.count = 0; // 出现的对象记录数
    this.types = new Map(); // 类型 -> 次数
    this.emptyStrings = 0; // 空字符串（含纯空白）
    this.nulls = 0;
    this.lenMin = Infinity; // 字符串长度统计
    this.lenMax = 0;
    this.lenSum = 0;
    this.lenCount = 0;
  }

  add(value) {
    this.count++;
    const t = jtype(value);
    this.types.set(t, (this.types.get(t) || 0) + 1);
    if (t === 'null') this.nulls++;
    if (t === 'string') {
      if (value.trim() === '') this.emptyStrings++;
      const len = value.length;
      this.lenMin = Math.min(this.lenMin, len);
      this.lenMax = Math.max(this.lenMax, len);
      this.lenSum += len;
      this.lenCount++;
    }
  }

  toReport(objectRecords) {
    const types = {};
    for (const [t, n] of [...this.types.entries()].sort((a, b) => b[1] - a[1])) {
      types[t] = n;
    }
    // null 表示"值为空"而非"类型错误"（nullable 字段很常见），
    // 类型一致性只看非 null 类型；null 由 nulls 计数单列
    const nonNullTypes = [...this.types.keys()].filter((t) => t !== 'null');
    return {
      name: this.name,
      count: this.count,
      missing: objectRecords - this.count,
      presenceRate: objectRecords > 0 ? round4(this.count / objectRecords) : 0,
      types,
      typeConsistent: nonNullTypes.length <= 1,
      emptyStrings: this.emptyStrings,
      nulls: this.nulls,
      length:
        this.lenCount > 0
          ? { min: this.lenMin, max: this.lenMax, avg: round4(this.lenSum / this.lenCount) }
          : null,
    };
  }
}

/**
 * 创建分析器：feed() 逐行喂入，finish() 产出报告对象。
 * options:
 *   sample       解析错误样例上限（默认 5）
 *   top          重复值/非法值 Top N（默认 30）
 *   uniqueFields 字段唯一性检查的字段列表（--unique）
 *   enums        枚举校验：{ 字段: Set(允许值) }（--enum），只判定非空字符串
 */
function createAnalyzer(options = {}) {
  const sampleLimit = options.sample ?? 5;
  const topLimit = options.top ?? 30;
  const fields = new Map();
  const seenLines = new Set(); // 跨文件完全重复检测（整条记录口径）
  const parseErrorSamples = [];

  // R1：字段唯一性（字段取值口径，与整条记录去重互不混淆）
  const uniqueCounters = new Map((options.uniqueFields || []).map((f) => [f, new ValueCounter()]));
  // R2：枚举校验
  const enumChecks = new Map(
    Object.entries(options.enums || {}).map(([f, allowed]) => [
      f,
      { allowed: [...allowed], invalid: new ValueCounter(), invalidRecords: 0 },
    ])
  );

  const summary = {
    files: 0,
    totalLines: 0,
    emptyLines: 0,
    validRecords: 0,
    objectRecords: 0,
    nonObjectRecords: 0,
    parseErrors: 0,
    duplicateRecords: 0,
  };
  const perFile = new Map();

  function fileOf(path) {
    if (!perFile.has(path)) {
      perFile.set(path, { path, lines: 0, empty: 0, valid: 0, parseErrors: 0 });
    }
    return perFile.get(path);
  }

  return {
    feed(file, lineNo, parsed) {
      const f = fileOf(file);
      f.lines++;
      summary.totalLines++;

      if (parsed.kind === 'empty') {
        f.empty++;
        summary.emptyLines++;
        return;
      }
      if (parsed.kind === 'error') {
        f.parseErrors++;
        summary.parseErrors++;
        if (parseErrorSamples.length < sampleLimit) {
          parseErrorSamples.push({ file, line: lineNo, message: parsed.message, snippet: parsed.snippet });
        }
        return;
      }
      // record
      f.valid++;
      summary.validRecords++;
      if (seenLines.has(parsed.raw)) {
        summary.duplicateRecords++;
      } else {
        seenLines.add(parsed.raw);
      }
      if (!parsed.isObject) {
        summary.nonObjectRecords++;
        return; // 字段统计只针对对象记录
      }
      summary.objectRecords++;
      const obj = parsed.value;
      for (const [k, v] of Object.entries(obj)) {
        if (!fields.has(k)) fields.set(k, new FieldStat(k));
        fields.get(k).add(v);
      }

      // R1：字段唯一性（null 与缺失不计；空串视为合法取值）
      for (const [field, counter] of uniqueCounters) {
        if (field in obj && obj[field] !== null) {
          counter.add(obj[field], file, lineNo);
        }
      }
      // R2：枚举校验（对 trim 后的值判定；trim 后为空串则跳过——
      // 与"空串 trim()===''" 的既有约定一致，也与 clean 先 trim 后判定的行为一致）
      for (const [field, check] of enumChecks) {
        const v = obj[field];
        if (typeof v !== 'string') continue; // null/非字符串由其他规则覆盖
        const t = v.trim();
        if (t !== '' && !check.allowed.includes(t)) {
          check.invalid.add(t, file, lineNo);
          check.invalidRecords++;
        }
      }
    },

    finish() {
      summary.files = perFile.size;
      const fieldReports = [...fields.values()]
        .map((f) => f.toReport(summary.objectRecords))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

      // R1 汇总
      const uniqueness = {};
      for (const [field, counter] of uniqueCounters) {
        const dups = counter.map.size > 0 ? [...counter.map.values()].filter((e) => e.count > 1) : [];
        uniqueness[field] = {
          distinctValues: counter.map.size,
          duplicateValues: dups.length,
          involvedRecords: dups.reduce((s, e) => s + e.count, 0),
          top: counter.top(topLimit).filter((e) => e.count > 1),
        };
      }
      // R2 汇总
      const enums = {};
      for (const [field, check] of enumChecks) {
        enums[field] = {
          allowed: check.allowed,
          invalidValues: check.invalid.map.size,
          invalidRecords: check.invalidRecords,
          top: check.invalid.top(topLimit),
        };
      }

      const issues = [];
      if (summary.parseErrors > 0) {
        issues.push({
          level: 'error',
          code: 'PARSE_ERROR',
          message: `JSON 解析失败 ${summary.parseErrors} 行（${pctNum(summary.parseErrors / summary.totalLines)}%）`,
        });
      }
      for (const f of fieldReports) {
        if (!f.typeConsistent) {
          const dist = Object.entries(f.types).map(([t, n]) => `${t}×${n}`).join(', ');
          issues.push({ level: 'warn', code: 'TYPE_INCONSISTENT', field: f.name, message: `字段 "${f.name}" 类型不一致：${dist}` });
        }
        if (f.missing > 0) {
          issues.push({ level: 'warn', code: 'FIELD_MISSING', field: f.name, message: `字段 "${f.name}" 缺失 ${f.missing} 条（覆盖率 ${pctNum(f.presenceRate)}%）` });
        }
      }
      for (const [field, u] of Object.entries(uniqueness)) {
        if (u.duplicateValues > 0) {
          issues.push({
            level: 'warn',
            code: 'FIELD_DUPLICATE',
            field,
            message: `字段 "${field}" 存在重复取值：${u.duplicateValues} 个值重复，涉及 ${u.involvedRecords} 条记录`,
          });
        }
      }
      for (const [field, e] of Object.entries(enums)) {
        if (e.invalidRecords > 0) {
          const allowStr = e.allowed.length <= 8 ? e.allowed.join(', ') : e.allowed.slice(0, 8).join(', ') + ` 等 ${e.allowed.length} 个`;
          issues.push({
            level: 'warn',
            code: 'ENUM_VIOLATION',
            field,
            message: `字段 "${field}" 存在非法枚举值：${e.invalidValues} 种取值，涉及 ${e.invalidRecords} 条记录（允许：${allowStr}）`,
          });
        }
      }
      if (summary.duplicateRecords > 0) {
        issues.push({ level: 'warn', code: 'DUPLICATE', message: `完全重复记录 ${summary.duplicateRecords} 条（跨文件去重口径）` });
      }
      if (summary.nonObjectRecords > 0) {
        issues.push({ level: 'warn', code: 'NON_OBJECT', message: `非对象记录 ${summary.nonObjectRecords} 条（顶层不是 {}，未参与字段统计）` });
      }

      return {
        tool: 'datalint',
        version: require('../package.json').version,
        generatedAt: new Date().toISOString(),
        summary: {
          ...summary,
          parseErrorRate: summary.totalLines > 0 ? round4(summary.parseErrors / summary.totalLines) : 0,
          fieldCount: fieldReports.length,
        },
        files: [...perFile.values()],
        fields: fieldReports,
        uniqueness,
        enums,
        parseErrorSamples,
        parseErrorSampleTotal: summary.parseErrors,
        issues,
      };
    },
  };
}

module.exports = { createAnalyzer };
