'use strict';

// ============ 编排层：参数解析 + 串联 读 → 解析 → 统计/清洗 → 渲染/写盘 ============
const fs = require('node:fs');
const path = require('node:path');
const { assertReadable, readLines } = require('./reader');
const { parseLine } = require('./parser');
const { createAnalyzer } = require('./analyze');
const { createCleaner } = require('./clean');
const { renderJson, renderText } = require('./render');
const { createLineWriter } = require('./writer');

// 退出码约定：0 正常；1 参数/用法错误；2 文件错误；3 --strict 下存在解析错误
const EXIT = { OK: 0, USAGE: 1, FILE: 2, STRICT: 3 };

const USAGE_TEXT = `用法：
  datalint [check] [选项] <文件.jsonl...>   质检与统计（默认命令）
  datalint clean   [选项] <文件.jsonl...>   定向清洗，输出干净/丢弃/报告三个文件

通用选项：
  -f, --format <text|json>   质检报告格式，默认 text
  -o, --output <文件>        质检报告写入文件（默认打印到 stdout）
      --sample <N>           解析错误样例最多展示 N 条，默认 5
      --top <N>              text 模式字段表最多展示 N 个字段，默认 30
      --strict               存在解析错误时以退出码 3 结束
      --unique <字段>        字段唯一性检查（可重复，仅 check）
      --enum <字段>=v1,v2    枚举值校验（可重复，check 检出 / clean 丢弃）
  -h, --help                 显示帮助
  -v, --version              显示版本

clean 专属选项：
      --required <a,b,c>     必填字段（须为非空字符串）
      --min-len <N>          必填字符串字段最小长度
      --max-len <N>          必填字符串字段最大长度
      --out-dir <目录>       输出目录，默认 output（生成 cleaned/rejected/clean-report）

输入兼容：UTF-8 BOM、CRLF、gzip 压缩（按 magic bytes 自动识别，不看扩展名）。
退出码：0 正常；1 参数错误；2 文件不存在/不可读；3 --strict 下有解析错误

目录约定：原始数据放 input/，清洗产物放 output/。`;

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = {
    mode: 'check',
    format: 'text',
    sample: 5,
    top: 30,
    strict: false,
    output: null,
    required: [],
    minLen: null,
    maxLen: null,
    outDir: null,
    unique: [],
    enums: {}, // { 字段: [允许值...] }
    files: [],
  };
  const checkOnly = new Set(['--unique']);
  const cleanOnly = new Set(['--required', '--min-len', '--max-len', '--out-dir']);
  const usedCheckOnly = [];
  const usedCleanOnly = [];

  let i = 0;
  if (argv[0] === 'check' || argv[0] === 'clean') {
    opts.mode = argv[0];
    i = 1;
  }

  const takeValue = (idx, inline, name) => {
    if (inline !== undefined) return [inline, idx];
    if (idx + 1 >= argv.length) throw new UsageError(`选项 ${name} 缺少参数值`);
    return [argv[idx + 1], idx + 1];
  };
  const toPositiveInt = (v, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new UsageError(`选项 ${name} 需要正整数，收到：${v}`);
    return n;
  };

  for (; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.startsWith('--') ? a.indexOf('=') : -1;
    const flag = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;

    if (flag === '-h' || flag === '--help') return { help: true };
    if (flag === '-v' || flag === '--version') return { version: true };
    if (flag === '--strict') opts.strict = true;
    else if (flag === '-f' || flag === '--format') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      if (v !== 'text' && v !== 'json') throw new UsageError(`--format 只支持 text 或 json，收到：${v}`);
      opts.format = v;
    } else if (flag === '-o' || flag === '--output') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      opts.output = v;
    } else if (flag === '--sample') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      opts.sample = toPositiveInt(v, flag);
    } else if (flag === '--top') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      opts.top = toPositiveInt(v, flag);
    } else if (flag === '--unique') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      usedCheckOnly.push(flag);
      const field = v.trim();
      if (field === '') throw new UsageError('--unique 需要非空字段名');
      opts.unique.push(field);
    } else if (flag === '--enum') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      const eq2 = v.indexOf('=');
      if (eq2 <= 0) throw new UsageError(`--enum 格式应为 字段=v1,v2,...，收到：${v}`);
      const field = v.slice(0, eq2).trim();
      const values = v.slice(eq2 + 1).split(',').map((s) => s.trim()).filter((s) => s !== '');
      if (field === '') throw new UsageError('--enum 字段名不能为空');
      if (values.length === 0) throw new UsageError(`--enum ${field}= 至少需要一个允许值`);
      if (field in opts.enums) throw new UsageError(`字段 "${field}" 的 --enum 重复设置`);
      opts.enums[field] = values;
    } else if (flag === '--required') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      usedCleanOnly.push(flag);
      opts.required = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.required.length === 0) throw new UsageError('--required 至少需要一个字段名');
    } else if (flag === '--min-len' || flag === '--max-len') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      usedCleanOnly.push(flag);
      if (flag === '--min-len') opts.minLen = toPositiveInt(v, flag);
      else opts.maxLen = toPositiveInt(v, flag);
    } else if (flag === '--out-dir') {
      const [v, ni] = takeValue(i, inline, flag);
      i = ni;
      usedCleanOnly.push(flag);
      opts.outDir = v;
    } else if (flag.startsWith('-')) {
      throw new UsageError(`未知选项：${a}`);
    } else {
      opts.files.push(a);
    }
  }

  if (opts.files.length === 0) throw new UsageError('请提供至少一个 JSONL 文件路径');
  if (opts.mode === 'check' && usedCleanOnly.length > 0) {
    throw new UsageError(`选项 ${usedCleanOnly[0]} 仅 clean 模式可用（用法：datalint clean ...）`);
  }
  if (opts.mode === 'clean' && usedCheckOnly.length > 0) {
    throw new UsageError(`选项 ${usedCheckOnly[0]} 仅 check 模式可用（用法：datalint check ...）`);
  }
  if (opts.minLen !== null && opts.maxLen !== null && opts.minLen > opts.maxLen) {
    throw new UsageError(`--min-len（${opts.minLen}）不能大于 --max-len（${opts.maxLen}）`);
  }
  return opts;
}

/** { 字段: [值...] } → { 字段: Set(值) } */
function toEnumSets(enums) {
  return Object.fromEntries(Object.entries(enums).map(([f, vs]) => [f, new Set(vs)]));
}

/** 检查所有输入文件可读，失败打印中文错误并返回 null */
function checkFilesOrReport(files) {
  try {
    for (const f of files) assertReadable(f);
    return true;
  } catch (e) {
    if (e.code === 'FILE_ERROR') {
      console.error(`错误：${e.message}`);
      return false;
    }
    throw e;
  }
}

async function runCheck(opts) {
  const analyzer = createAnalyzer({
    sample: opts.sample,
    top: opts.top,
    uniqueFields: opts.unique,
    enums: toEnumSets(opts.enums),
  });
  for (const file of opts.files) {
    let lineNo = 0;
    for await (const line of readLines(file)) {
      lineNo++;
      analyzer.feed(file, lineNo, parseLine(line));
    }
  }
  const report = analyzer.finish();
  const rendered = opts.format === 'json' ? renderJson(report) : renderText(report, { top: opts.top });

  if (opts.output) {
    fs.writeFileSync(opts.output, rendered + '\n', 'utf8');
    console.error(`报告已写入：${opts.output}`);
  } else {
    console.log(rendered);
  }

  if (opts.strict && report.summary.parseErrors > 0) return EXIT.STRICT;
  return EXIT.OK;
}

async function runClean(opts) {
  const outDir = opts.outDir || 'output';
  fs.mkdirSync(outDir, { recursive: true });
  const cleanedPath = path.join(outDir, 'cleaned.jsonl');
  const rejectedPath = path.join(outDir, 'rejected.jsonl');
  const reportPath = path.join(outDir, 'clean-report.json');

  const cleaner = createCleaner({ required: opts.required, minLen: opts.minLen, maxLen: opts.maxLen, enums: toEnumSets(opts.enums) });
  const cleaned = createLineWriter(cleanedPath);
  const rejected = createLineWriter(rejectedPath);

  for (const file of opts.files) {
    let lineNo = 0;
    for await (const line of readLines(file)) {
      lineNo++;
      const r = cleaner.process(parseLine(line), file, lineNo);
      if (r.keep) await cleaned.write(JSON.stringify(r.record));
      else await rejected.write(JSON.stringify(r.entry));
    }
  }
  await cleaned.close();
  await rejected.close();

  const report = cleaner.finish({
    input: { files: opts.files },
    outputs: { cleaned: cleanedPath, rejected: rejectedPath, report: reportPath },
  });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  const s = report.stats;
  console.log(`清洗完成：输入 ${s.lines} 行 → 保留 ${s.kept} 条，丢弃 ${s.dropped} 条（${(s.dropRate * 100).toFixed(2)}%），trim 修复 ${s.fixedTrim} 个字段`);
  if (Object.keys(s.reasons).length > 0) {
    console.log('丢弃原因：' + Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}×${n}`).join(', '));
  }
  console.log(`产物：${cleanedPath} | ${rejectedPath} | ${reportPath}`);
  return EXIT.OK;
}

async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`错误：${e.message}\n\n${USAGE_TEXT}`);
      return EXIT.USAGE;
    }
    throw e;
  }

  if (opts.help) {
    console.log(USAGE_TEXT);
    return EXIT.OK;
  }
  if (opts.version) {
    console.log(require('../package.json').version);
    return EXIT.OK;
  }

  if (!checkFilesOrReport(opts.files)) return EXIT.FILE;

  return opts.mode === 'clean' ? runClean(opts) : runCheck(opts);
}

module.exports = { run, parseArgs, EXIT };
