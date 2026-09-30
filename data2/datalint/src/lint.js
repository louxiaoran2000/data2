// 编排：读文件 → 解析 → 必填校验 → 汇总，返回结构化报告对象（不含任何输出逻辑）
// 单个文件读取失败时记录原因并继续处理其余文件（容错续跑）
import { readLines, FileReadError } from './reader.js';
import { parseLines } from './parser.js';
import { summarizeFile, countFields } from './stats.js';
import { checkRequired } from './validator.js';

export function runLint(files, options = {}) {
  const { encoding = 'utf8', require: requiredFields = [] } = options;

  const fileSummaries = [];
  const allRecords = [];
  const readErrors = [];

  for (const file of files) {
    let lines;
    try {
      lines = readLines(file, encoding);
    } catch (err) {
      if (err instanceof FileReadError) {
        readErrors.push({ file, reason: err.message });
        continue;
      }
      throw err;
    }

    const parseResult = parseLines(lines);
    const summary = summarizeFile(file, lines, parseResult);
    // 未提供 --require 时为空对象 {}，保持 json 结构稳定
    summary.missingRequired = Object.fromEntries(checkRequired(parseResult.records, requiredFields));

    fileSummaries.push(summary);
    allRecords.push(...parseResult.records);
  }

  const totals = {
    totalLines: fileSummaries.reduce((sum, f) => sum + f.totalLines, 0),
    validLines: fileSummaries.reduce((sum, f) => sum + f.validLines, 0),
    invalidLines: fileSummaries.reduce((sum, f) => sum + f.invalidLines, 0),
    missingRequired: totalMissingRequired(fileSummaries, requiredFields),
  };

  return {
    files: fileSummaries,
    totals,
    fieldCounts: countFields(allRecords),
    errors: readErrors,
    requiredFields,
  };
}

// 汇总各文件每个必填字段的缺失总数。
// 用 Map 收集再 Object.fromEntries 输出：普通对象字面量以 result[field] = ... 赋值时，
// field 为 "__proto__" 会走原型 setter 被静默忽略，导致字段丢失（D2 缺陷修复）
function totalMissingRequired(fileSummaries, requiredFields) {
  const totals = new Map();
  for (const field of requiredFields) {
    totals.set(field, fileSummaries.reduce((sum, f) => sum + (f.missingRequired[field]?.length ?? 0), 0));
  }
  return Object.fromEntries(totals);
}
