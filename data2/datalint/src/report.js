// 报告渲染：text 为中文可读表格，json 为机器可读结构（字段按出现次数降序、同名按字典序）
import { REASON_ORDER } from './parser.js';

export function renderText(report) {
  const parts = [];

  for (const file of report.files) {
    parts.push(
      [
        `===== 文件：${file.file} =====`,
        `总行数：${file.totalLines}`,
        `合法行数：${file.validLines}`,
        `非法行数：${file.invalidLines}`,
        renderInvalidDetails(file),
      ].join('\n'),
    );
  }

  parts.push(
    [
      '===== 汇总 =====',
      `文件数：${report.files.length}`,
      `总行数：${report.totals.totalLines}`,
      `合法行数：${report.totals.validLines}`,
      `非法行数：${report.totals.invalidLines}`,
    ].join('\n'),
  );

  // 必填字段缺失区块：仅在提供了 --require 时出现
  if (report.requiredFields.length > 0) {
    parts.push(renderMissingRequired(report));
  }

  parts.push(renderFieldCounts(report));

  // 读取失败区块：仅在存在失败文件时出现
  if (report.errors.length > 0) {
    parts.push(['===== 读取失败的文件 =====', ...report.errors.map((err) => `- ${err.reason}`)].join('\n'));
  }

  return parts.join('\n\n');
}

export function renderJson(report) {
  return JSON.stringify(
    {
      files: report.files,
      totals: report.totals,
      // 字段统计用有序数组而非对象：普通对象会把"类整数字符串键"强制按数值升序重排，
      // 导致排序信息丢失（D1 缺陷修复）
      fieldCounts: sortedFieldEntries(report.fieldCounts).map(([field, count]) => ({ field, count })),
      errors: report.errors,
    },
    null,
    2,
  );
}

// 非法行按原因分类分组展示；无非法行时显示"无"
function renderInvalidDetails(file) {
  if (file.invalidLineDetails.length === 0) {
    return '非法行分类：无';
  }

  const groups = new Map(REASON_ORDER.map((reason) => [reason, []]));
  for (const { line, reason } of file.invalidLineDetails) {
    groups.get(reason).push(line);
  }

  const lines = ['非法行分类：'];
  for (const [reason, lineNumbers] of groups) {
    if (lineNumbers.length > 0) {
      lines.push(`  ${reason}：第 ${lineNumbers.join(', ')} 行`);
    }
  }
  return lines.join('\n');
}

// 必填字段缺失：按文件分组，逐字段列出行号或"无"
function renderMissingRequired(report) {
  const lines = ['===== 必填字段缺失 ====='];
  for (const file of report.files) {
    lines.push(`文件：${file.file}`);
    for (const field of report.requiredFields) {
      const missing = file.missingRequired[field] ?? [];
      lines.push(`  ${field}：${missing.length > 0 ? `第 ${missing.join(', ')} 行` : '无'}`);
    }
  }
  return lines.join('\n');
}

function renderFieldCounts(report) {
  const entries = sortedFieldEntries(report.fieldCounts);
  const width = Math.max(4, ...entries.map(([key]) => key.length));
  const lines = [`===== 字段统计（跨文件合并，基于 ${report.totals.validLines} 条合法记录）=====`];
  if (entries.length === 0) {
    lines.push('（无合法记录，无字段统计）');
  } else {
    lines.push(`${'字段'.padEnd(width)}  出现次数`);
    for (const [key, count] of entries) {
      lines.push(`${key.padEnd(width)}  ${count}`);
    }
  }
  return lines.join('\n');
}

function sortedFieldEntries(fieldCounts) {
  return [...fieldCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
