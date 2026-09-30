'use strict';

// ============ 读取层：只负责"把文件变成一行行字符串" ============
const fs = require('node:fs');
const readline = require('node:readline');
const zlib = require('node:zlib');

/** 读取前检查，失败抛出带 code 的中文错误 */
function assertReadable(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    const err = new Error(`文件不存在或无法访问：${filePath}`);
    err.code = 'FILE_ERROR';
    throw err;
  }
  if (!stat.isFile()) {
    const err = new Error(`路径不是普通文件：${filePath}`);
    err.code = 'FILE_ERROR';
    throw err;
  }
}

/** 按文件头 magic bytes（1F 8B）识别 gzip，不看扩展名 */
function isGzipFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(2);
    const n = fs.readSync(fd, buf, 0, 2, 0);
    return n === 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 流式逐行读取，大文件不占内存。
 * gzip 文件自动解压后进入同一管线（BOM/CRLF/空行口径不变），行号为压缩包内逻辑行号。
 */
async function* readLines(filePath) {
  let stream = fs.createReadStream(filePath);
  if (isGzipFile(filePath)) {
    stream = stream.pipe(zlib.createGunzip());
  }
  stream.setEncoding('utf8');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      yield line;
    }
  } catch (e) {
    const err = new Error(`读取文件失败：${filePath}（${e.message}）`);
    err.code = 'FILE_ERROR';
    throw err;
  } finally {
    rl.close();
    stream.destroy();
  }
}

module.exports = { assertReadable, readLines, isGzipFile };
