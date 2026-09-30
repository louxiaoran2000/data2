// 统计聚合：单文件行级汇总 + 跨文件字段出现次数
export function summarizeFile(filePath, lines, parseResult) {
  return {
    file: filePath,
    totalLines: lines.length,
    validLines: parseResult.records.length,
    invalidLines: parseResult.errors.length,
    invalidLineNumbers: parseResult.errors.map((err) => err.line),
    // 非法行明细（行号 + 原因分类），供报告层分组展示
    invalidLineDetails: parseResult.errors.map((err) => ({ line: err.line, reason: err.reason })),
  };
}

// 统计每个字段名在多少条合法记录中出现过（同一条记录内同一字段只计一次）
export function countFields(records) {
  const counts = new Map();
  for (const { value } of records) {
    for (const key of Object.keys(value)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}
