# 第一阶段：初始实现 — 开发记录

> 这篇是我的开发笔记，记一下当时怎么想的、怎么拆的，方便后面回来看。

## 当时的需求是啥

从空目录做一个 Node.js 命令行工具 `datalint`：给它一个或多个 JSONL 文件，它帮你做质检和统计。要求只用 Node 标准库、不装第三方包；`npm install` 之后用 `node bin/datalint.js ...` 就能跑；输出分 text（给人看的表格）和 json（给程序读的）两种；文件不存在或者没传参数，要用中文报错并且退出码非 0。

选这个题主要是因为 Goleta 本来就是做数据标注的，标注交付前查一下 JSONL 质量是个真实场景，不是硬造的题。

## 我怎么拆的

核心想法一句话：**读文件、解析、统计、渲染这四件事分开**，中间用"报告对象"传数据。这样以后加功能只动其中一层，不用翻整个代码。

```
bin/datalint.js                 入口，串流程、接错误、定退出码
  ├─ src/cli.js   parseArgs     把 argv 变成 { files, format, help }，不碰文件
  ├─ src/lint.js  runLint       总调度：逐文件 读 → 解析 → 汇总，攒出报告对象
  │    ├─ src/reader.js  readLines      文件 → 一行一行的数组
  │    ├─ src/parser.js  parseLines     行 → 哪些合法、哪些非法
  │    └─ src/stats.js   汇总和字段计数
  └─ src/report.js renderText / renderJson   报告对象 → 两种格式的字符串
```

这么拆还有个好处：`runLint` 返回的是纯数据，不含任何打印逻辑，所以 text 和 json 只是同一份数据的两种"画法"。

## 每个函数具体干了什么

| 函数 | 干啥的 | 要注意的点 | 复杂度 |
| --- | --- | --- | --- |
| `parseArgs(argv)` | 解析命令行参数 | 扫一遍就行；`--format json` 和 `--format=json` 两种写法都认；不认识 `-` 开头的参数直接报用法错误 | O(参数个数) |
| `readLines(path)` | 文件读进来切成行 | `readFileSync` 按 utf8 读；开头有 BOM 就去掉；按 `\r\n` 或 `\n` 切都能兼容；文件最后那个换行符不会多出一个空行来 | O(文件大小) |
| `parseLines(lines)` | 判断每行合不合法 | 逐行 `JSON.parse`，抛异常就是非法行；解析出来了但不是对象（数组、null、数字这些）也算非法；行号就是下标 +1 | O(行数) |
| `summarizeFile(...)` | 单个文件的汇总 | 总行数、合法数、非法数、非法行号，拼个对象 | O(1) |
| `countFields(records)` | 统计字段出现次数 | 用 Map 数：这个字段在多少条记录里出现过（同一条记录里只算一次） | O(总字段数) |
| `runLint(files)` | 把上面串起来 | 多文件的 records 合到一起再统计字段；totals 就是各文件加起来 | O(总记录数) |
| `renderText/renderJson` | 画报告 | 字段按"次数多的在前，一样多按名字字典序"排，保证每次输出都一样 | O(F log F) |

## 几个自己定的规矩（需求没写死，我拍的板）

1. **什么叫合法行**：得是 JSON，而且解析出来得是对象。数组、`null`、纯数字这些一律算非法行。
2. **空行怎么算**：算总行数，也算非法行（空串喂给 `JSON.parse` 本来就报错）；但文件结尾的换行符不额外算一行。
3. **编码**：就当 UTF-8 处理，顺手把 BOM 去了。
4. **多文件时某个文件读不出来**：直接中止（fail-fast），退出码 1。
   （⚠️ 这条在阶段二被需求 R3 改掉了，变成容错续跑，别搞混。）
5. **退出码**：0 成功 / 1 文件读取失败 / 2 参数用法错误。
6. 报错信息全用中文，需求里明确要了的。

## 跑起来验收的情况（2026-09-29 实际跑的）

| 验收点 | 命令 | 结果 |
| --- | --- | --- |
| 安装 | `npm install` | ✅ 零依赖，秒过 |
| 单文件 text | `node bin/datalint.js examples/users.jsonl` | ✅ 8 行/合法 6/非法 2（第 4、6 行），exit=0 |
| 单文件 json | `node bin/datalint.js --format json examples/users.jsonl` | ✅ 结构没问题，exit=0 |
| 多文件合并 | `node bin/datalint.js examples/users.jsonl examples/extra.jsonl` | ✅ 合计 11 行/合法 8/非法 3；字段跨文件合并对了（id=8），exit=0 |
| 没传参数 | `node bin/datalint.js` | ✅ 中文报错，exit=2 |
| 文件不存在 | `node bin/datalint.js not-exist.jsonl` | ✅ 中文报错，exit=1 |
| format 乱填 | `--format xml` | ✅ 中文报错，exit=2 |
| 帮助 | `--help` | ✅ 出用法说明，exit=0 |

示例数据是故意这么造的：`users.jsonl` 第 4 行是个没写完的 JSON（语法错误），第 6 行是个数组（不是对象），这样两种非法情况都能演出来；`extra.jsonl` 第 3 行也是坏的，专门用来验多文件合并。
