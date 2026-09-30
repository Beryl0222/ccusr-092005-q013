# 跨物种单细胞资料空间

项目整理不同实验室、组织和物种的单细胞表达资料及基因映射版本，便于研究者复现跨物种比较。Node.js 模块提供样例读取和基本结构校验。

执行 `npm test` 可运行现有检查。

## 假设验证协作后端

`CollaborationService`（`src/service.js`）把模型结论改写成可被反驳的实验主张，并管理从提出、认领、预注册、盲态提交到解盲汇总与公开的完整流程。现有海绵数据集与 UCE 运行（`fixtures/seed.json`）可直接作为假设来源。

### 流程与不变量

1. **提出主张**：必须引用真实分析运行/数据集，给出适用细胞集合、至少一条预测现象、至少一条反例条件；来源的模型与基因映射版本随主张快照保存。
2. **实验室认领**：样本与技术能力必须覆盖主张要求；多个实验室可并发认领同一主张，同一实验室不可重复认领。
3. **预注册**：实验开始前冻结关键步骤与主要终点；修订必须说明理由，全部版本历史保留。
4. **暂停不删除**：伦理限制、样本不足、资源冲突、模型换版只允许暂停并解释；主张、认领记录与预注册历史（启动依据）全部保留，审计日志只增不删。
5. **盲态提交**：各实验室在互不可见阶段提交测量摘要与原始材料哈希（sha256）；测量必须指向主张中的预测或反例；解盲后停止接收提交。
6. **解盲汇总**：未暂停任务全部提交后方可解盲；允许结论相反；综合判断始终同时呈现支持、反驳与未完成证据；失败复现与负结果计入贡献台账。
7. **公开门槛**：数据授权与署名范围都通过后才允许公开。
8. **读者卷宗**：`getClaimDossier(hypothesisId)` 从任一主张查到验证方案（含版本历史）、执行团队、来源版本关系、尚未解决的反例、综合判断与公开状态。

### 最小示例

```js
import { loadSeed, CollaborationService } from "./src/index.js";

const { records } = await loadSeed();
const svc = new CollaborationService({ records });

const hyp = svc.proposeHypothesis({
  title: "海绵领细胞表达与青蛙神经元同源的转录模块",
  sourceRecordId: "embedding-run-uce-17",
  cellSets: [
    { datasetId: "dataset-sponge-choanocyte", cellType: "choanocyte" },
    { datasetId: "frog-neuron-08", cellType: "neuron", species: "青蛙" },
  ],
  predictions: ["领细胞的神经元同源模块得分显著高于海绵其他细胞类型"],
  counterexamples: ["若模块得分不高于其他细胞类型，则主张被反驳"],
  requiredCapabilities: { species: ["海绵", "青蛙"], techniques: ["scRNA-seq"] },
});

const lab = svc.registerLab({
  name: "跨物种联合实验室",
  capabilities: { species: ["海绵", "青蛙"], techniques: ["scRNA-seq"] },
});
const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: lab.id });
svc.freezePreregistration({
  undertakingId: claim.id,
  keySteps: ["取样", "建库", "测序"],
  primaryEndpoints: ["模块得分差值"],
});
svc.beginExperiment({ undertakingId: claim.id });
// …提交、解盲、综合判断、审批与公开见 test/scenario.test.js 的完整流程
```

### 模块结构

- `src/hypotheses.js` — 主张提出与来源/细胞集合校验
- `src/labs.js` — 实验室注册与能力门槛
- `src/undertakings.js` — 认领、预注册冻结/修订、暂停/恢复状态机
- `src/submissions.js` — 盲态提交、哈希校验、解盲与可见性
- `src/synthesis.js` — 综合判断、未解决反例、贡献台账
- `src/publication.js` — 数据授权、署名范围与公开门槛
- `src/service.js` — 门面与读者卷宗；`src/store.js` — 存储与审计日志
