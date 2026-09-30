# datalint

JSONL 数据质检与统计命令行工具。面向数据标注场景：在交付前快速检查 JSONL 文件的行合法性、必填字段完整性，并统计字段分布。

- 仅使用 Node.js 标准库实现，**零第三方依赖**
- 支持多文件输入、逐行质检（非法行按原因分类）、跨文件字段统计
- 支持必填字段校验、UTF-8 / GBK 编码、单文件失败容错续跑
- 支持文本表格与 JSON 两种报告格式，内置 `node:test` 自动化测试

## 环境要求

Node.js >= 18（开发环境为 v22）。

## 安装

```bash
npm install
```

安装后可直接运行：

```bash
node bin/datalint.js <文件...>
```

也可以 `npm link` 后使用 `datalint` 命令（可选）。

## 用法

```
node bin/datalint.js [--format text|json] [--require <字段名>]... [--encoding utf8|gbk] <文件...>
```

| 参数 | 说明 |
| --- | --- |
| `<文件...>` | 一个或多个 JSONL 文件路径 |
| `--format text\|json` | 输出格式，默认 `text`；`json` 输出机器可读报告到 stdout |
| `--require <字段名>` | 必填字段校验，可重复（也支持 `--require=字段名`）；缺失仅在报告中呈现，**不影响退出码** |
| `--encoding utf8\|gbk` | 输入文件编码，默认 `utf8`（也支持 `--encoding=gbk`） |
| `-h, --help` | 显示帮助 |

### 退出码

| 退出码 | 含义 |
| --- | --- |
| 0 | 全部文件处理成功 |
| 1 | 至少一个文件读取失败（其余文件的报告照常输出） |
| 2 | 参数用法错误（未提供文件、非法选项取值、未知选项） |

> 注：第一阶段为"任一文件读取失败即中止"，第二阶段起变更为容错续跑——失败文件记录在报告的"读取失败的文件"区块（json 为顶层 `errors` 数组），退出码为 1。

## 输出示例

```bash
$ node bin/datalint.js --require id --require label examples/users.jsonl examples/extra.jsonl
===== 文件：examples/users.jsonl =====
总行数：8
合法行数：6
非法行数：2
非法行分类：
  JSON 语法错误：第 4 行
  非 JSON 对象：第 6 行

===== 文件：examples/extra.jsonl =====
总行数：3
合法行数：2
非法行数：1
非法行分类：
  JSON 语法错误：第 3 行

===== 汇总 =====
文件数：2
总行数：11
合法行数：8
非法行数：3

===== 必填字段缺失 =====
文件：examples/users.jsonl
  id：无
  label：无
文件：examples/extra.jsonl
  id：无
  label：第 1, 2 行

===== 字段统计（跨文件合并，基于 8 条合法记录）=====
字段        出现次数
id        8
text      7
label     6
score     5
source    2
extra     1
flagged   1
reviewed  1
```

存在读取失败文件时（exit 1），报告末尾追加：

```
===== 读取失败的文件 =====
- 文件不存在：not-exist.jsonl
```

`--format json` 输出结构（节选）：

```json
{
  "files": [
    {
      "file": "examples/users.jsonl",
      "totalLines": 8,
      "validLines": 6,
      "invalidLines": 2,
      "invalidLineNumbers": [4, 6],
      "invalidLineDetails": [
        { "line": 4, "reason": "JSON 语法错误" },
        { "line": 6, "reason": "非 JSON 对象" }
      ],
      "missingRequired": {}
    }
  ],
  "totals": { "totalLines": 8, "validLines": 6, "invalidLines": 2, "missingRequired": {} },
  "fieldCounts": [
    { "field": "id", "count": 6 },
    { "field": "label", "count": 6 },
    { "field": "text", "count": 6 },
    { "field": "score", "count": 5 },
    { "field": "extra", "count": 1 },
    { "field": "reviewed", "count": 1 }
  ],
  "errors": []
}
```

GBK 编码文件示例：

```bash
$ node bin/datalint.js --encoding gbk examples/data-gbk.jsonl
# 总行数：3  合法行数：2  非法行数：1（第 3 行），中文无乱码
```

## 规则与假设

- **合法行**：该行是 JSON 且解析结果为对象（数组、数字、字符串、`null` 均计为非法行）。
- **非法行三分类**：空行（去除空白后长度为 0）／JSON 语法错误／非 JSON 对象。
- 文件结尾的换行符不产生额外的空行；兼容 LF 与 CRLF 换行。
- **必填字段**：以 `Object.keys` 是否包含字段名为准，值为 `null` 视为存在；非法行不参与必填检查；缺失不影响退出码。
- **编码**：默认 UTF-8（自动去 BOM）；`--encoding gbk` 用内置 `TextDecoder` 解码；异常字节按 U+FFFD 替换，不中断。
- **容错**：任一文件读取失败不中止，其余文件正常出报告；读取失败的文件不出现在 json 的 `files` 中，而是列入顶层 `errors`。
- 字段统计以"该字段在多少条合法记录中出现过"计数，跨文件合并，按出现次数降序、同次数按字段名字典序排列；json 中 `fieldCounts` 为**有序数组**（`[{"field": "...", "count": N}]`），以保证"类整数字段名"下顺序语义不丢失。

## 测试

```bash
npm test
```

使用 Node 内置 `node:test`（无第三方依赖），覆盖 parser / reader / validator / stats / cli 单元测试与 CLI 端到端测试（退出码、报告内容、GBK 示例）。

## 本期限制（范围外）

- 不支持 CSV 等其他数据格式；编码仅支持 UTF-8 与 GBK
- 不做超大文件的流式处理优化

## 目录结构

```
datalint/
├── bin/datalint.js   # 命令行入口：参数 → 质检 → 报告 → 退出码
├── src/
│   ├── cli.js        # 参数解析（--format / --require / --encoding / --help）
│   ├── reader.js     # 文件读取与切行（编码解码、BOM、CRLF 处理）
│   ├── parser.js     # 逐行 JSON 解析，非法行三分类
│   ├── validator.js  # 必填字段缺失校验
│   ├── stats.js      # 行级汇总与字段出现次数统计
│   ├── lint.js       # 编排：读取（容错）→ 解析 → 校验 → 汇总为报告对象
│   └── report.js     # text / json 两种报告渲染
├── test/             # node:test 单元测试与端到端测试
└── examples/         # 示例数据（含非法行；data-gbk.jsonl 为 GBK 编码）
```
