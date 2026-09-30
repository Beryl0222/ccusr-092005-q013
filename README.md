# 跨物种单细胞假设验证协作后端

在「跨物种单细胞资料空间」基线之上，为联合课题组提供**可被反驳的假设验证协作**后端。
面向的典型情形：UCE 等分析运行把海绵领细胞排在青蛙神经元附近、把名为 neuroid 的细胞
指向腺体功能——课题组不直接对外传播最吸引人的阳性结果，而是先把结论改写为可反驳的实验
主张，由具备样本与技术能力的实验室独立认领与验证。

## 设计原则

- **真实来源**：假设只能引用目录中已完成分析运行（如 `embedding-run-uce-17`）产生的发现；
  适用细胞集合必须在该运行输入范围内。现有海绵数据集与 UCE 运行（v4.2.1 / v4.3.0）见
  `fixtures/seed.json`。
- **可反驳性**：提出时必须给出适用细胞集合、预测现象和至少一条反例条件。
- **独立认领**：多个实验室可针对同一模型版本并发认领，认领时声明样本与技术能力；
  存储用乐观并发控制（OCC）防止并发覆盖。
- **先冻结后执行**：实验开始前提交并冻结关键步骤与主要终点；冻结前的修订连同理由永久
  留痕，冻结后不可改写。
- **只能暂停、不能抹除**：伦理限制、样本不足、资源冲突或模型换版只能暂停实验并附说明；
  全部状态由**只追加事件**推导（事件溯源），认领、方案、启动依据永不删除。
- **互不可见 → 解盲**：盲态阶段提交测量摘要与原始材料哈希（`sha256:…`），其他实验室只
  看到「已提交」；解盲后允许结论相反。
- **三类证据并列**：综合判断同时呈现支持、反驳、未完成证据；失败复现与负结果计入贡献
  台账。
- **双闸门公开**：数据授权与署名范围对所有参与实验室通过后才允许发布；任一撤销即重新
  关闭闸门。发布后可从任一主张公开追溯验证方案、执行团队、版本关系与未决反例。

## 运行

```bash
npm test          # 14 项测试（目录、生命周期、并发、冻结、盲态、闸门、持久化、HTTP）
npm start         # 等价于 node src/server.js，默认 :8080
PORT=9000 node src/server.js
```

事件持久化在 `data/events.jsonl`（已在 `.gitignore`），重启后完整回放；
不指定文件时测试使用内存存储。

## HTTP 接口

| 方法 & 路径 | 作用 |
| --- | --- |
| `GET /catalog` | 数据集、分析运行、发现目录 |
| `POST /hypotheses` | 从 `{findingId, runId?, title, cellSet, predictions, falsifiers}` 提出假设 |
| `GET /hypotheses` / `GET /hypotheses/:id` | 假设列表 / 详情（含版本、修订数、事件史） |
| `POST /hypotheses/:id/claim` | 实验室认领（须含 `sampleCapability`、`technicalCapability`） |
| `POST /hypotheses/:id/preregistrations` | 提交预注册（关键步骤、主要终点） |
| `POST /hypotheses/:id/preregistrations/revise` | 冻结前修订（必须给 `rationale`） |
| `POST /hypotheses/:id/freeze` | 冻结关键步骤与主要终点 |
| `POST /hypotheses/:id/pause` | 暂停，`reason ∈ ethics \| sample_shortage \| resource_conflict \| model_version_change`，须附 `explanation` |
| `POST /hypotheses/:id/resume` / `fail` | 恢复（附说明）/ 如实记录失败复现 |
| `POST /hypotheses/:id/submissions` | 盲态提交：`summary`、`rawDataHash`、`conclusionDirection ∈ supports\|refutes\|inconclusive` |
| `POST /hypotheses/:id/unseal` | 解盲（可带 `expectedLabIds` 校验提交齐全） |
| `POST /hypotheses/:id/counterexamples[/{ceId}/resolve]` | 解盲后登记/处理反例 |
| `POST /hypotheses/:id/data-authorizations[/revoke]` | 数据授权授予/撤销 |
| `POST /hypotheses/:id/authorship-approvals[/revoke]` | 署名范围审批/撤销 |
| `POST /hypotheses/:id/publish` | 双闸门通过后公开 |
| `GET /hypotheses/:id/view?lab=<labId>` | 实验室视角（盲态期间对他人提交脱敏） |
| `GET /hypotheses/:id/synthesis` | 支持/反驳/未完成证据 + 贡献台账 + 相反结论标记 |
| `GET /hypotheses/:id/gating` | 各实验室授权/署名闸门状态 |
| `GET /hypotheses/:id/trace` | 公开追溯（仅发布后）：方案、团队、版本关系、未决反例、完整事件日志 |

## 代码结构

```
src/
  seed.js     基线样例读取（保留）
  catalog.js  数据集/运行/发现目录与引用完整性校验
  errors.js   DomainError（错误码 → HTTP 状态映射）
  store.js    MemoryEventStore / JsonlEventStore（只追加 + OCC）
  hub.js      聚合 reducer 与全部协作命令、投影（view/synthesis/gating/trace）
  api.js      node:http JSON 适配层
  server.js   组装目录、持久化存储与 API 并启动
test/         node:test 测试
fixtures/     领域种子（海绵领细胞/neuroid、蛙神经元、两次 UCE 运行及发现）
```
