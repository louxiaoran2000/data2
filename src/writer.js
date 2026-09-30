'use strict';

// ============ 写入层：流式写 JSONL（与 reader 对称） ============
const fs = require('node:fs');

function createLineWriter(filePath) {
  const stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
  return {
    /** 写一行；内部缓冲满时等待 drain，避免内存膨胀 */
    write(line) {
      return new Promise((resolve, reject) => {
        const ok = stream.write(line + '\n', (err) => (err ? reject(err) : undefined));
        if (ok) resolve();
        else stream.once('drain', resolve);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        stream.end((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

module.exports = { createLineWriter };
