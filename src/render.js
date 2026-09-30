'use strict';

// ============ 渲染层：只负责"把报告对象变成输出字符串" ============

/** 显示宽度：CJK 等宽字符按 2 列算，保证表格对齐 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x20000 && cp <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function padCell(s, width) {
  const gap = width - displayWidth(s);
  return String(s) + (gap > 0 ? ' '.repeat(gap) : '');
}

/** 简单对齐表格：headers + rows（字符串二维数组） */
function table(headers, rows) {
  const cols = headers.length;
  const widths = new Array(cols).fill(0);
  for (const row of [headers, ...rows]) {
    for (let i = 0; i < cols; i++) {
      widths[i] = Math.max(widths[i], displayWidth(row[i]));
    }
  }
  const lines = [headers.map((h, i) => padCell(h, widths[i])).join('  ')];
  lines.push(widths.map((w) => '─'.repeat(w)).join('──'));
  for (const row of rows) {
    lines.push(row.map((c, i) => padCell(c, widths[i])).join('  '));
  }
  return lines;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const trunc = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/** 行号样例格式化：单文件只显示行号，多文件带文件名 */
function fmtSamples(samples, singleFile) {
  return samples.map((s) => (singleFile ? String(s.line) : `${s.file}:${s.line}`)).join(', ');
}

/** 取值计数 Top 列表格式化："a"×3（行 1,3,5）; ... */
function fmtTop(entries, singleFile) {
  if (entries.length === 0) return '-';
  return trunc(
    entries.map((e) => `${JSON.stringify(e.value)}×${e.count}（行 ${fmtSamples(e.samples, singleFile)}）`).join('; '),
    72
  );
}

function renderJson(report) {
  return JSON.stringify(report, null, 2);
}

function renderText(report, options = {}) {
  const top = options.top ?? 30;
  const s = report.summary;
  const out = [];

  out.push('datalint 质检报告');
  out.push(`时间：${report.generatedAt}    文件数：${s.files}`);
  out.push('');

  // 概览
  out.push('[概览]');
  out.push(`  总行数      ${s.totalLines}`);
  out.push(`  空行        ${s.emptyLines}`);
  out.push(`  有效记录    ${s.validRecords}（其中非对象记录 ${s.nonObjectRecords}）`);
  out.push(`  解析错误    ${s.parseErrors}（${pct(s.parseErrorRate)}）`);
  out.push(`  完全重复    ${s.duplicateRecords}`);
  out.push(`  字段总数    ${s.fieldCount}`);
  out.push('');

  // 分文件（多文件时展示）
  if (report.files.length > 1) {
    out.push('[分文件]');
    const rows = report.files.map((f) => [f.path, String(f.lines), String(f.valid), String(f.parseErrors), String(f.empty)]);
    for (const line of table(['文件', '行数', '有效', '解析错误', '空行'], rows)) out.push('  ' + line);
    out.push('');
  }

  // 字段统计
  if (report.fields.length > 0) {
    out.push(`[字段统计]（覆盖率 = 含该字段的对象记录 / 对象记录总数 ${s.objectRecords}）`);
    const shown = report.fields.slice(0, top);
    const rows = shown.map((f) => [
      trunc(f.name, 32),
      pct(f.presenceRate),
      String(f.missing),
      trunc(Object.entries(f.types).map(([t, n]) => `${t}:${n}`).join(', '), 40),
      String(f.emptyStrings),
      String(f.nulls),
      f.length ? `${f.length.min}/${f.length.avg.toFixed(1)}/${f.length.max}` : '-',
    ]);
    for (const line of table(['字段', '覆盖率', '缺失', '类型分布', '空串', 'null', '长度 小/均/大'], rows)) {
      out.push('  ' + line);
    }
    if (report.fields.length > top) out.push(`  … 其余 ${report.fields.length - top} 个字段略（--top 调整）`);
    out.push('');
  }

  // 字段唯一性（--unique）
  const uniqueEntries = Object.entries(report.uniqueness || {});
  if (uniqueEntries.length > 0) {
    const singleFile = report.files.length === 1;
    out.push('[字段唯一性]（--unique 字段取值口径，与"完全重复记录"无关）');
    const rows = uniqueEntries.map(([field, u]) => [
      trunc(field, 32),
      String(u.distinctValues),
      String(u.duplicateValues),
      String(u.involvedRecords),
      fmtTop(u.top, singleFile),
    ]);
    for (const line of table(['字段', 'distinct 值', '重复值', '涉及记录', 'Top 重复值'], rows)) {
      out.push('  ' + line);
    }
    out.push('');
  }

  // 枚举校验（--enum）
  const enumEntries = Object.entries(report.enums || {});
  if (enumEntries.length > 0) {
    const singleFile = report.files.length === 1;
    out.push('[枚举校验]（--enum 允许取值之外的非空字符串）');
    const rows = enumEntries.map(([field, e]) => [
      trunc(field, 32),
      String(e.allowed.length),
      String(e.invalidValues),
      String(e.invalidRecords),
      fmtTop(e.top, singleFile),
    ]);
    for (const line of table(['字段', '允许值数', '非法值', '涉及记录', 'Top 非法值'], rows)) {
      out.push('  ' + line);
    }
    out.push('');
  }

  // 解析错误样例
  if (report.parseErrorSamples.length > 0) {
    out.push(`[解析错误样例]（共 ${report.parseErrorSampleTotal} 条，展示前 ${report.parseErrorSamples.length} 条）`);
    for (const e of report.parseErrorSamples) {
      out.push(`  ${e.file}:${e.line}  ${e.message}`);
      out.push(`    片段：${e.snippet}`);
    }
    out.push('');
  }

  // 问题汇总
  out.push(report.issues.length > 0 ? '[问题汇总]' : '[问题汇总] 未发现问题 ✅');
  for (const i of report.issues) {
    out.push(`  [${i.level === 'error' ? '错误' : '警告'}] ${i.message}`);
  }

  return out.join('\n');
}

module.exports = { renderJson, renderText };
