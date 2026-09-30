# datalint

JSONL 数据质检与定向清洗命令行工具，面向训练数据场景。**仅依赖 Node 标准库**（Node ≥ 18），无任何第三方包。

## 目录约定

```
input/    原始数据（如下载的开源数据集）
output/   清洗产物与报告（cleaned.jsonl / rejected.jsonl / clean-report.json）
```

## 数据集总结：databricks-dolly-15k

> 以下结论均来自本工具的实际产物（`output/clean-report.json`、`output/check-after-clean.json`）。

### 数据类型

- 格式：JSONL，每行一个 JSON 对象，UTF-8 编码。
- 结构：SFT 指令微调样本，固定 4 个字段，**全部为 string 类型**、覆盖率 100%、无 null：

| 字段 | 含义 | 长度（字符，小/均/大） |
| --- | --- | --- |
| `instruction` | 指令/问题（模型输入） | 4 / 71.9 / 11698 |
| `context` | 可选上下文（模型输入，空串=无上下文） | 0 / 352.9 / 23505 |
| `response` | 期望回答（监督目标） | 1 / 358.1 / 26018 |
| `category` | 任务类别标签（元信息） | 7 / 11.8 / 22 |

### 数据包含内容

Databricks 员工标注的英文指令数据（CC BY-SA 3.0），清洗后 15003 条，覆盖 **8 种任务类别**：

| 类别 | 条数 | 占比 | 类别 | 条数 | 占比 |
| --- | --- | --- | --- | --- | --- |
| open_qa | 3739 | 24.9% | brainstorming | 1766 | 11.8% |
| general_qa | 2190 | 14.6% | information_extraction | 1506 | 10.0% |
| classification | 2136 | 14.2% | summarization | 1188 | 7.9% |
| closed_qa | 1769 | 11.8% | creative_writing | 709 | 4.7% |

- **4463 条（29.7%）带 context**（多为 closed_qa / summarization / 抽取类）；10540 条 context 为空串，属开放式任务的正常形态，非数据缺陷。
- 极短 response（如 "Tope"、"2013"）是分类/抽取任务的合法答案，清洗时不应按长度误伤。

### 输入与输出总结

- **输入** `input/databricks-dolly-15k.jsonl`：15011 行 / 13MB。质检结论——0 解析错误、字段 100% 覆盖、类型一致，唯一问题是 **8 条完全重复**。
- **输出** `output/`（`clean --required instruction,response` 的产物）：

| 文件 | 内容 |
| --- | --- |
| `cleaned.jsonl` | **15003 条**干净数据：去重 8 条（0.05%）、trim 修复 14 个字段，复检 0 问题 |
| `rejected.jsonl` | 8 条丢弃记录（全部为 `duplicate`），含 `_source` 行号可回溯 |
| `clean-report.json` | 清洗规则与统计 |
| `check-after-clean.json` | 清洗后复检报告 |

净效果：以 0.05% 的代价消除全部重复样本，字段结构与内容分布保持不变。

## 安装与运行

```bash
npm install

# 质检：text 表格给人看，json 给程序读，-o 落盘
node bin/datalint.js input/databricks-dolly-15k.jsonl
node bin/datalint.js input/databricks-dolly-15k.jsonl -f json -o output/report.json

# 定向清洗（先质检发现问题，再针对问题选规则）
node bin/datalint.js clean input/databricks-dolly-15k.jsonl --required instruction,response

npm link && datalint ...   # 可选：注册为全局命令
```

## 两个子命令

### `check`（默认）：质检与统计

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `-f, --format <text\|json>` | 报告格式 | `text` |
| `-o, --output <文件>` | 报告写入文件（不打 stdout） | — |
| `--sample <N>` | 解析错误样例展示条数 | `5` |
| `--top <N>` | text 模式字段表最多展示字段数 | `30` |
| `--strict` | 存在解析错误时退出码 3 | 关 |

检出内容：解析错误（行号+片段）、完全重复（跨文件）、字段覆盖率/缺失、类型一致性、空串/null、字符串长度分布（小/均/大）、非对象记录。

### `clean`：定向清洗

```bash
node bin/datalint.js clean <文件...> [--required a,b,c] [--min-len N] [--max-len N] [--out-dir output]
```

规则：**丢弃**——空行、解析失败、非对象记录、缺必填字段、必填字段非字符串/空串、必填字段长度越界、规范化后完全重复；**修复**——字符串字段 trim。短回答可能是分类/抽取任务的合法答案（如 "Tope"、"2013"），`--min-len` 请按数据特点谨慎使用。

产物（写入 `--out-dir`，默认 `output/`）：

| 文件 | 内容 |
| --- | --- |
| `cleaned.jsonl` | 保留的干净记录（已 trim、已去重） |
| `rejected.jsonl` | 丢弃记录，含 `_reject` 原因与 `_source` 文件/行号，可回溯 |
| `clean-report.json` | 清洗规则与统计（保留/丢弃数、原因分布、trim 修复数） |

## 输入规范

- 每行一个 JSON 值（JSONL）；空行跳过并计数。
- 顶层为对象 `{}` 的记录参与字段统计；数组/标量记为"非对象记录"。
- 自动兼容 UTF-8 BOM 与 CRLF。

## 输出规范（check -f json）

```jsonc
{
  "tool": "datalint", "version": "1.0.0", "generatedAt": "…",
  "summary": { "totalLines": 0, "validRecords": 0, "parseErrors": 0,
               "duplicateRecords": 0, "fieldCount": 0, "parseErrorRate": 0 },
  "files":  [ { "path": "…", "lines": 0, "valid": 0, "parseErrors": 0, "empty": 0 } ],
  "fields": [ { "name": "text", "count": 0, "missing": 0, "presenceRate": 1,
                "types": { "string": 0 }, "typeConsistent": true,
                "emptyStrings": 0, "nulls": 0,
                "length": { "min": 0, "avg": 0, "max": 0 } } ],  // 非字符串字段为 null
  "parseErrorSamples": [ { "file": "…", "line": 1, "message": "…", "snippet": "…" } ],
  "issues": [ { "level": "error|warn", "code": "…", "message": "…" } ]
}
```

问题类型（`issues[].code`）：`PARSE_ERROR`（错误级）、`TYPE_INCONSISTENT`、`FIELD_MISSING`、`DUPLICATE`、`NON_OBJECT`。`null` 视为"值为空"而非类型错误：不参与类型一致性判断，由 `nulls` 单列计数。

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 正常 |
| 1 | 参数错误（未传文件、未知选项、非法取值、check 模式误用 clean 选项） |
| 2 | 文件不存在 / 不可读 / 不是普通文件 |
| 3 | `--strict` 下存在解析错误 |

## 实战示例：databricks-dolly-15k 定向清洗

```bash
# 1. 下载开源数据集（CC BY-SA 3.0，15k 条英文 SFT 指令数据）
curl -sL -o input/databricks-dolly-15k.jsonl \
  https://huggingface.co/datasets/databricks/databricks-dolly-15k/resolve/main/databricks-dolly-15k.jsonl

# 2. 先质检：发现 8 条完全重复，其余字段 100% 覆盖
node bin/datalint.js input/databricks-dolly-15k.jsonl

# 3. 定向清洗：必填字段校验 + 去重 + trim
node bin/datalint.js clean input/databricks-dolly-15k.jsonl --required instruction,response
# → 保留 15003 条，丢弃 8 条重复，trim 修复 14 个字段

# 4. 复检产物：0 问题
node bin/datalint.js output/cleaned.jsonl
```

## 架构

读文件、解析、统计、清洗、渲染、写盘分层，中间用"报告对象"传数据，加功能只动一层：

```
bin/datalint.js  入口薄壳
src/cli.js       参数解析 + 编排（check / clean 两个子命令）
src/reader.js    读：流式逐行（fs + readline，大文件不占内存）
src/parser.js    解析：单行 → 空行 / 错误 / 记录
src/analyze.js   统计：逐行 feed，finish 产出质检报告对象
src/clean.js     清洗：规则引擎，逐条给出 保留/修复/丢弃
src/render.js    渲染：报告对象 → text 表格（CJK 对齐）/ json
src/writer.js    写：流式写 JSONL（带背压）
```

## 测试

```bash
npm test   # node:test，14 个用例：退出码、双格式、落盘、清洗规则与产物
```
