# 第三阶段：缺陷处理 — 缺陷报告与开发文档

基于第二阶段实际产物（`datalint/` 当前代码）复查发现 **2 个可复现缺陷**。二者均为阶段二代码中自然引入的问题，非人为植入；已于 2026-09-29 用真实命令复现确认（输出见下文）。

> 说明：笔试仅三个阶段，本无"阶段四"；本阶段包含"缺陷报告 → 定位修复 → 同一复现检查复测"完整闭环。

## 0. 缺陷总览

| 编号 | 缺陷 | 位置 | 复现确认 |
| --- | --- | --- | --- |
| D1 | json 报告 `fieldCounts` 对"整数字段名"排序失效，与 text 报告及 README 声明不一致 | src/report.js `renderJson` | ✅ 已复现 |
| D2 | `--require __proto__` 时 `totals.missingRequired` 丢失该字段，与逐文件结果不一致 | src/lint.js `totalMissingRequired` | ✅ 已复现 |

---

## D1 json 报告 fieldCounts 排序失效

### 复现步骤

```bash
printf '{"10": "a", "x": 1}\n{"10": "b"}\n{"2": "c"}\n' > /tmp/num-fields.jsonl
node bin/datalint.js --format json /tmp/num-fields.jsonl
```

### 实际现象（2026-09-29 真实输出）

json 中 `fieldCounts` 为 `{"2":1,"10":2,"x":1}`（键顺序 `2, 10, x`）；而同一数据的 text 报告字段统计顺序为 `10(2)、2(1)、x(1)`。README 声明"按出现次数降序、同次数按字段名字典序"，json 输出未遵守。

### 期望行为

两种输出格式的字段排序一致，均为 `10(2)、2(1)、x(1)`（次数降序 → 字典序）。

### 根因分析（定位后填写→已确认）

`renderJson` 用 `Object.fromEntries(sortedFieldEntries(...))` 把有序数组转成普通对象。**JS 对象对"类整数字符串键"强制按数值升序重排**（ES 规范的自有键枚举顺序：整数索引键升序优先于字符串键插入序），因此 `"10"`、`"2"` 被重排为 `"2"、"10"`，排序信息在对象化一步丢失。text 报告直接遍历有序数组，不受影响——这解释了两种格式不一致。

### 修复方案

普通对象无法承载"类整数键"的顺序语义，将 json 的 `fieldCounts` 从对象改为**有序数组**：
`"fieldCounts": [{"field": "10", "count": 2}, {"field": "2", "count": 1}, {"field": "x", "count": 1}]`。
属 json 结构修正（README 与示例同步更新；text 报告不变）。补充回归测试：类整数字段名下 json 字段顺序与次数降序一致。

---

## D2 --require __proto__ 时 totals.missingRequired 丢字段

### 复现步骤

```bash
node bin/datalint.js --format json --require __proto__ examples/extra.jsonl
```

### 实际现象（2026-09-29 真实输出）

`files[0].missingRequired` 为 `{"__proto__":[1,2]}`（正确），但 `totals.missingRequired` 为 `{}`（该字段整体丢失）。同一报告内两处自相矛盾。

### 期望行为

`totals.missingRequired` 为 `{"__proto__": 2}`，与逐文件缺失行数合计一致。

### 根因分析（定位后填写→已确认）

`src/lint.js` 的 `totalMissingRequired` 用普通对象字面量 `const result = {}` 并以 `result[field] = count` 赋值。**当 field 为 `"__proto__"` 时，赋值走的是原型 setter 而非新建自有属性**；setter 收到非对象值（数字）时静默忽略，键根本未创建，且无任何报错。逐文件结果由 `Object.fromEntries` 生成（内部走 CreateDataPropertyOnObject，会创建自有属性），所以正常——这解释了两处不一致。

### 修复方案

`totalMissingRequired` 改用 `Map` 收集后经 `Object.fromEntries` 输出（与逐文件路径同一构造方式，彻底避开 `__proto__` setter）。补充回归测试：`--require __proto__` 时 totals 与逐文件合计一致。

---

## 阶段三缺陷处理需求（正式指令草案）

> 在当前 datalint 项目中发现两个可复现缺陷，请定位、修复并解释根因。要求：修复前后执行同一复现命令并保留实际输出作对照；只做缺陷修复与相应回归测试，不引入新需求。
>
> **缺陷 D1**：json 报告的 `fieldCounts` 排序与 README 声明（按出现次数降序）及 text 报告不一致。
> 复现：`printf '{"10": "a", "x": 1}\n{"10": "b"}\n{"2": "c"}\n' > /tmp/num-fields.jsonl && node bin/datalint.js --format json /tmp/num-fields.jsonl`。
> 实际：`fieldCounts` 为 `{"2":1,"10":2,"x":1}`。期望：与 text 报告一致的 `10、2、x` 顺序。
>
> **缺陷 D2**：`--require __proto__` 时 `totals.missingRequired` 丢失该字段。
> 复现：`node bin/datalint.js --format json --require __proto__ examples/extra.jsonl`。
> 实际：逐文件为 `{"__proto__":[1,2]}`，totals 为 `{}`。期望：totals 为 `{"__proto__": 2}`。

## 复测记录（修复前后同一复现命令对照）

| 编号 | 复现命令 | 修复前（实际输出） | 修复后（实际输出） |
| --- | --- | --- | --- |
| D1 | `node bin/datalint.js --format json /tmp/num-fields.jsonl` | `fieldCounts` 为 `{"2":1,"10":2,"x":1}`（"2" 被重排到 "10" 前） | `[{"field":"10","count":2},{"field":"2","count":1},{"field":"x","count":1}]`（顺序 10、2、x，与 text 报告一致）✅ |
| D2 | `node bin/datalint.js --format json --require __proto__ examples/extra.jsonl` | 逐文件 `{"__proto__":[1,2]}`，totals `{}` | 逐文件 `{"__proto__":[1,2]}`，totals `{"__proto__":2}` ✅ |

## 修复实施记录（2026-09-29）

| 编号 | 修改文件 | 修改内容 | 回归测试 |
| --- | --- | --- | --- |
| D1 | `src/report.js` `renderJson` | `fieldCounts` 由对象改为有序数组 `[{field, count}]`（普通对象无法承载类整数键的顺序语义）；README 的 json 示例与规则说明同步更新 | 新增 `test/report.test.js`：类整数字段名顺序用例 + 空数组用例 |
| D2 | `src/lint.js` `totalMissingRequired` | 改用 `Map` 收集 + `Object.fromEntries` 输出，避开 `__proto__` 原型 setter；与逐文件构造方式一致 | `test/e2e.test.js` 新增用例：`--require __proto__` 时 totals 与逐文件合计一致 |

- 修复后 `npm test`：tests 31 / pass 31 / fail 0（含 2 个缺陷回归用例）。
- 修复范围仅限两处缺陷及其回归测试、README 同步说明，未引入新需求。
- 附带说明：D1 修复使 json 的 `fieldCounts` 结构由对象变为有序数组，属缺陷修复必需的结构修正（README 已注明）；text 报告结构不变。
