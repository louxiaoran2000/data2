// 命令行参数解析：负责 --format、--require、--encoding、--help 与文件列表，不触碰文件系统
import { ENCODINGS } from './reader.js';

export class UsageError extends Error {}

export const USAGE =
  '用法：node bin/datalint.js [--format text|json] [--require <字段名>]... [--encoding utf8|gbk] <文件...>';

export const HELP = `datalint —— JSONL 数据质检与统计工具

${USAGE}

参数：
  <文件...>            一个或多个 JSONL 文件路径
  --format text|json   输出格式，默认 text（人类可读表格）；json 为机器可读报告
  --require <字段名>    必填字段校验，可重复（也支持 --require=字段名）；
                       缺失仅在报告中呈现，不影响退出码
  --encoding utf8|gbk  输入文件编码，默认 utf8（也支持 --encoding=gbk）
  -h, --help           显示本帮助

退出码：0 全部文件处理成功；1 至少一个文件读取失败；2 参数用法错误`;

const FORMATS = new Set(['text', 'json']);

export function parseArgs(argv) {
  const files = [];
  const requiredFields = [];
  let format = 'text';
  let encoding = 'utf8';
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      help = true;
      continue;
    }
    if (arg === '--format') {
      format = checkFormat(takeValue(argv, i, '--format'));
      i++;
      continue;
    }
    if (arg.startsWith('--format=')) {
      format = checkFormat(arg.slice('--format='.length));
      continue;
    }
    if (arg === '--require') {
      addRequired(requiredFields, takeValue(argv, i, '--require'));
      i++;
      continue;
    }
    if (arg.startsWith('--require=')) {
      addRequired(requiredFields, arg.slice('--require='.length));
      continue;
    }
    if (arg === '--encoding') {
      encoding = checkEncoding(takeValue(argv, i, '--encoding'));
      i++;
      continue;
    }
    if (arg.startsWith('--encoding=')) {
      encoding = checkEncoding(arg.slice('--encoding='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new UsageError(`未知选项：${arg}`);
    }
    files.push(arg);
  }

  if (!help && files.length === 0) {
    throw new UsageError('未提供任何输入文件');
  }

  return { files, format, encoding, require: requiredFields, help };
}

// 取选项后面的值；缺失或以 '-' 开头（疑似另一个选项）时判为缺少取值
function takeValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new UsageError(`${option} 缺少取值`);
  }
  return value;
}

function addRequired(requiredFields, field) {
  if (field === '') {
    throw new UsageError('--require 取值不能为空');
  }
  if (!requiredFields.includes(field)) {
    requiredFields.push(field);
  }
}

function checkFormat(value) {
  if (!FORMATS.has(value)) {
    throw new UsageError(`--format 只支持 text 或 json，收到：${value}`);
  }
  return value;
}

function checkEncoding(value) {
  if (!ENCODINGS.has(value)) {
    throw new UsageError(`--encoding 只支持 utf8 或 gbk，收到：${value}`);
  }
  return value;
}
