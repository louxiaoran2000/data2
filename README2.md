# README2：R1 / R2 / R3 新功能输入输出总结

> 本文汇总三个新功能的**输入（命令 + 数据）**与**输出（报告/产物）**实测结果。
> 每个功能给两个尺度：验收 fixture（小数据、精确断言）+ 真实数据集 databricks-dolly-15k（15011 条）。
> 所有输出均为实际运行原文，对应自动化测试见 `test/r123.test.js`（23/23 通过）。

## R1【校验】字段唯一性 `--unique <字段>`

检查指定字段的**取值级**重复（id 撞车、instruction 重复），与既有的"整条记录完全重复"口径互不混淆。

### 输入

```bash
# 验收 fixture：test/fixtures/dup-id.jsonl（5 行，id 依次为 a、b、a、c、a，各行 text 均不同）
node bin/datalint.js test/fixtures/dup-id.jsonl --unique id

# 真实数据集
node bin/datalint.js input/databricks-dolly-15k.jsonl --unique instruction
```

### 输出（fixture，text 小节原文）

```
[字段唯一性]（--unique 字段取值口径，与"完全重复记录"无关）
  字段  distinct 值  重复值  涉及记录  Top 重复值
  ────────────────────────────────────────────────────────
  id    3            1       3         "a"×3（行 1, 3, 5）
```

json 顶层新增 `uniqueness`（截取）：

```json
"uniqueness": {
  "id": {
    "distinctValues": 3, "duplicateValues": 1, "involvedRecords": 3,
    "top": [ { "value": "a", "count": 3,
               "samples": [ {"line": 1}, {"line": 3}, {"line": 5} ] } ]
  }
}
```

issues 新增：`FIELD_DUPLICATE`（warn 级）。

### 结论

| 尺度 | 结果 |
| --- | --- |
| fixture（5 行） | 重复值 **1 个**（`"a"`）、涉及记录 **3 条**、行号 **1/3/5**；整行重复为 0，证明两口径独立 |
| dolly（15011 条） | instruction：distinct 14779，**重复值 149 个、涉及 381 条**——整行去重只发现 8 条，字段级检查多发现约 47 倍问题记录 |

## R2【校验】枚举值校验 `--enum <字段>=v1,v2,...`

标签字段必须落在标签体系内。check 检出（`ENUM_VIOLATION`，warn 级）+ clean 丢弃（原因 `enum_violation`）。

**判定口径**（check 与 clean 严格一致）：对 **trim 后**的值判定——`"math "` 判非法、`"open_qa "` trim 后合法放行（clean 中由 trim 修复）、纯空白 `" "` 跳过并计入空串统计、null/非字符串交给既有类型与空值规则。一条记录只记一次 `enum_violation`。

### 输入

```bash
# 验收 fixture：test/fixtures/enum.jsonl（3 行，category 为 open_qa、math、closed_qa）
node bin/datalint.js test/fixtures/enum.jsonl --enum category=open_qa,closed_qa          # check
node bin/datalint.js clean test/fixtures/enum.jsonl --enum category=open_qa,closed_qa --out-dir output/   # clean
```

### 输出（check，text 小节原文）

```
[枚举校验]（--enum 允许取值之外的非空字符串）
  字段      允许值数  非法值  涉及记录  Top 非法值
  ──────────────────────────────────────────────────────
  category  2         1       1         "math"×1（行 2）
```

### 输出（clean，stdout 原文 + 产物）

```
清洗完成：输入 3 行 → 保留 2 条，丢弃 1 条（33.33%），trim 修复 0 个字段
丢弃原因：enum_violation×1
```

`rejected.jsonl` 中的丢弃条目（含 `_source` 可回溯）：

```json
{"_reject": ["enum_violation"], "_source": {"file": "test/fixtures/enum.jsonl", "line": 2},
 "data": {"instruction": "问题二", "response": "回答二", "category": "math"}}
```

### 结论

| 尺度 | check | clean |
| --- | --- | --- |
| fixture（3 行） | 非法值 **1 个**（`"math"`，第 2 行） | 保留 **2**、丢弃 **1**，`_reject=enum_violation` |
| dolly（15011 条，8 类标签全量校验） | **0 违规**——标签体系干净 | — |

## R3【兼容】gzip 压缩输入自动识别

按文件头 **magic bytes（1F 8B）** 识别 gzip，不看扩展名、不新增选项；解压后走同一条流式管线（BOM/CRLF/空行口径不变），行号为压缩包内逻辑行号。

### 输入

```bash
gzip -k test/fixtures/bad.jsonl          # 生成 bad.jsonl.gz
node bin/datalint.js test/fixtures/bad.jsonl.gz          # check：直接读 .gz
node bin/datalint.js clean test/fixtures/bad.jsonl.gz --required text,label   # clean：同样支持
```

### 输出（summary 逐项对比，原文）

```
gz 统计: {"files":1,"totalLines":6,"emptyLines":1,"validRecords":4,"objectRecords":4,
          "nonObjectRecords":0,"parseErrors":1,"duplicateRecords":1,"parseErrorRate":0.1667,"fieldCount":2}
原文统计: {"files":1,"totalLines":6,"emptyLines":1,"validRecords":4,"objectRecords":4,
          "nonObjectRecords":0,"parseErrors":1,"duplicateRecords":1,"parseErrorRate":0.1667,"fieldCount":2}
```

dolly 全量（15011 条 / 13MB → gz 4MB）对比同样逐项一致：

```
原文: {"totalLines":15011,"validRecords":15011,"parseErrors":0,"duplicateRecords":8,"fieldCount":4,...}
gzip: {"totalLines":15011,"validRecords":15011,"parseErrors":0,"duplicateRecords":8,"fieldCount":4,...}
```

### 结论

| 验证点 | 结果 |
| --- | --- |
| check 统计（fixture + dolly） | 与未压缩版本**完全一致**（含解析错误行号等逻辑行号） |
| clean 产物 | `.gz` 与原文输入的 kept/dropped/原因分布逐项一致 |
| 扩展名无关性 | 无 `.gz` 后缀的 gzip 文件（magic bytes 识别）同样正常 |
| 非 gzip 文件 | 行为与此前版本完全一致（回归测试保障） |

## 总览

| 需求 | 新增输入 | 新增输出 | issues code | 实测发现（dolly） |
| --- | --- | --- | --- | --- |
| R1 字段唯一性 | `--unique <字段>`（check，可重复） | text"字段唯一性"小节 + json `uniqueness` | `FIELD_DUPLICATE` | 149 个重复指令 / 381 条（整行去重仅 8 条） |
| R2 枚举校验 | `--enum <字段>=v1,v2`（check + clean，可重复） | text"枚举校验"小节 + json `enums` + clean 丢弃原因 `enum_violation` | `ENUM_VIOLATION` | 8 类标签 0 违规 |
| R3 gzip 输入 | 无（自动识别，magic bytes） | 无新增——所有既有输出对 `.gz` 直接可用 | — | 15011 条统计与原文一致 |
