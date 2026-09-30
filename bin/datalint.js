#!/usr/bin/env node
'use strict';

// CLI 薄入口：只负责调用编排层并设置退出码
const { run } = require('../src/cli');

run(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`错误：${err && err.message ? err.message : err}`);
    process.exitCode = 2;
  }
);
