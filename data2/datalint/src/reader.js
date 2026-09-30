// 文件读取与切行：默认 UTF-8，可通过 --encoding 指定 GBK
import { readFileSync } from 'node:fs';

export class FileReadError extends Error {}

// 支持的输入编码白名单（解码使用 Node 内置 TextDecoder，非致命模式：异常字节替换为 U+FFFD）
export const ENCODINGS = new Set(['utf8', 'gbk']);

// 读取文件并按行拆分。
// 约定：兼容 CRLF/LF；文件结尾的换行符不产生额外的空行；
// 中间出现的空行保留，由解析层按非法行处理；BOM 去除仅在 utf8 下生效。
export function readLines(filePath, encoding = 'utf8') {
  let buffer;
  try {
    buffer = readFileSync(filePath);
  } catch (err) {
    throw new FileReadError(describeReadError(filePath, err));
  }

  let content = new TextDecoder(encoding, { fatal: false }).decode(buffer);
  if (encoding === 'utf8' && content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1); // 去掉 UTF-8 BOM，避免首行解析失败
  }
  if (content === '') {
    return [];
  }

  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function describeReadError(filePath, err) {
  switch (err.code) {
    case 'ENOENT':
      return `文件不存在：${filePath}`;
    case 'EISDIR':
      return `路径是目录而非文件：${filePath}`;
    case 'EACCES':
      return `没有读取权限：${filePath}`;
    default:
      return `无法读取文件：${filePath}（${err.message}）`;
  }
}
