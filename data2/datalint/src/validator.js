// 必填字段校验：仅针对合法记录。
// 存在性语义与 stats.countFields 一致：Object.keys 包含字段名即视为存在（值为 null 也算存在）。
export function checkRequired(records, requiredFields) {
  const missing = new Map(requiredFields.map((field) => [field, []]));

  for (const { line, value } of records) {
    const keys = new Set(Object.keys(value));
    for (const field of requiredFields) {
      if (!keys.has(field)) {
        missing.get(field).push(line);
      }
    }
  }

  return missing;
}
