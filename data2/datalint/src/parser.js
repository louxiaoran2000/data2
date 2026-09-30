// 逐行解析：每一行必须是 JSON 对象，否则计入非法行
// 非法行按原因分为三类：空行 / JSON 语法错误 / 非 JSON 对象
export const REASONS = {
  EMPTY: '空行',
  SYNTAX: 'JSON 语法错误',
  NOT_OBJECT: '非 JSON 对象',
};

// 报告分组展示时的固定类别顺序
export const REASON_ORDER = [REASONS.EMPTY, REASONS.SYNTAX, REASONS.NOT_OBJECT];

export function parseLines(lines) {
  const records = [];
  const errors = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (line.trim() === '') {
      errors.push({ line: lineNumber, reason: REASONS.EMPTY });
      return;
    }

    let value;
    try {
      value = JSON.parse(line);
    } catch {
      errors.push({ line: lineNumber, reason: REASONS.SYNTAX });
      return;
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      errors.push({ line: lineNumber, reason: REASONS.NOT_OBJECT });
      return;
    }

    records.push({ line: lineNumber, value });
  });

  return { records, errors };
}
