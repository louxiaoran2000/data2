#!/usr/bin/env node
// datalint 命令行入口：解析参数 → 逐文件质检 → 渲染报告 → 设置退出码
// 退出码：0 全部文件处理成功；1 至少一个文件读取失败；2 参数用法错误
import { parseArgs, UsageError, USAGE, HELP } from '../src/cli.js';
import { runLint } from '../src/lint.js';
import { renderText, renderJson } from '../src/report.js';

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`错误：${err.message}`);
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    throw err;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  const report = runLint(options.files, options);
  console.log(options.format === 'json' ? renderJson(report) : renderText(report));

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
