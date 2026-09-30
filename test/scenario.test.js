import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadSeed } from "../src/seed.js";
import { CollaborationService } from "../src/service.js";
import { HYP_A, HYP_B, registerLabs } from "./helpers.js";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

test("端到端：从 UCE 运行提出主张，经并发认领、预注册修订、暂停恢复、盲态提交到解盲汇总与公开", async () => {
  const { records } = await loadSeed();
  const svc = new CollaborationService({ records });
  const labs = registerLabs(svc);

  // 1. 两条主张都来自真实种子：UCE 运行 + 海绵数据集
  const hypA = svc.proposeHypothesis({ ...HYP_A, proposedBy: "联合课题组" });
  const hypB = svc.proposeHypothesis({ ...HYP_B, proposedBy: "联合课题组" });
  assert.equal(hypA.source.model, "UCE");
  assert.equal(hypB.source.datasets[0].geneMapVersion, "ortholog-2026-04");

  // 2. 能力门槛：只有海绵样本的实验室不能认领跨物种主张
  assert.throws(
    () => svc.claimHypothesis({ hypothesisId: hypA.id, labId: labs.spongeOnly.id }),
    /不具备认领条件/,
  );

  // 3. 并发认领：两个实验室同时认领主张 A
  const [claimJoint, claimFrog] = await Promise.all([
    svc.claimHypothesis({ hypothesisId: hypA.id, labId: labs.joint.id }),
    svc.claimHypothesis({ hypothesisId: hypA.id, labId: labs.frog.id }),
  ]);
  const claimGland = svc.claimHypothesis({ hypothesisId: hypB.id, labId: labs.gland.id });

  // 4. 预注册：冻结关键步骤与主要终点；frog 实验室修订一次
  svc.freezePreregistration({
    undertakingId: claimJoint.id,
    keySteps: ["海绵取样", "单细胞建库", "测序质控"],
    primaryEndpoints: ["神经元同源模块得分差值"],
  });
  svc.freezePreregistration({
    undertakingId: claimFrog.id,
    keySteps: ["海绵与青蛙取样", "单细胞建库"],
    primaryEndpoints: ["神经元同源模块得分差值"],
  });
  svc.revisePreregistration({
    undertakingId: claimFrog.id,
    keySteps: ["海绵与青蛙取样", "批次平衡设计", "单细胞建库"],
    primaryEndpoints: ["神经元同源模块得分差值"],
    reason: "评审要求加入批次平衡",
  });
  svc.freezePreregistration({
    undertakingId: claimGland.id,
    keySteps: ["石蜡切片", "粘液基因原位染色"],
    primaryEndpoints: ["分泌颗粒有无"],
  });

  // 5. 模型换版 → 暂停并解释，随后恢复；启动依据保留
  svc.beginExperiment({ undertakingId: claimFrog.id });
  svc.pauseUndertaking({
    undertakingId: claimFrog.id,
    category: "model_version_change",
    explanation: "UCE 发布新版本，需确认新旧嵌入可比后再继续",
  });
  svc.resumeUndertaking({ undertakingId: claimFrog.id, note: "版本差异不影响该模块" });

  svc.beginExperiment({ undertakingId: claimJoint.id });
  svc.beginExperiment({ undertakingId: claimGland.id });

  // 6. 样本不足 → 主张 B 暂停；主张与预注册仍在
  svc.pauseUndertaking({
    undertakingId: claimGland.id,
    category: "sample_shortage",
    explanation: "当季 neuroid 细胞样本量不足",
  });
  assert.equal(svc.getHypothesis(hypB.id).status, "open");

  // 7. 盲态提交：两个实验室结论相反
  svc.submitMeasurements({
    undertakingId: claimJoint.id,
    conclusion: "supports",
    rawHash: sha256("joint-raw-fastq"),
    summary: {
      measurements: [
        { subject: "pred-1", observed: "模块得分 2.3 倍于其他细胞类型" },
        { subject: "cx-1", observed: "差异显著，反例未触发" },
      ],
    },
  });
  svc.submitMeasurements({
    undertakingId: claimFrog.id,
    conclusion: "refutes",
    rawHash: sha256("frog-raw-fastq"),
    summary: { measurements: [{ subject: "pred-1", observed: "模块得分无显著差异" }] },
  });

  // 8. 互不可见阶段：各自只能看到自己的提交
  assert.equal(svc.listSubmissions(hypA.id, { requestingLabId: labs.joint.id }).length, 1);
  assert.equal(svc.listSubmissions(hypA.id, { requestingLabId: labs.frog.id }).length, 1);

  // 9. 解盲：主张 A 双方提交齐全；主张 B 因暂停且无提交不能解盲
  svc.unblindHypothesis({ hypothesisId: hypA.id });
  assert.equal(svc.listSubmissions(hypA.id, { requestingLabId: labs.joint.id }).length, 2);
  assert.throws(() => svc.unblindHypothesis({ hypothesisId: hypB.id }), /没有任何测量提交/);

  // 10. 综合判断：支持与反驳同时呈现
  const synthesisA = svc.getSynthesis(hypA.id);
  assert.equal(synthesisA.verdict, "contested");
  assert.equal(synthesisA.supporting.length, 1);
  assert.equal(synthesisA.refuting.length, 1);

  // 11. 读者卷宗：验证方案、执行团队、版本关系、尚未解决的反例
  const dossierA = svc.getClaimDossier(hypA.id);
  assert.deepEqual(
    dossierA.teams.map((t) => t.name).sort(),
    ["两爬神经实验室", "跨物种联合实验室"],
  );
  assert.equal(dossierA.source.model, "UCE");
  assert.equal(dossierA.source.datasets[0].geneMapVersion, "ortholog-2026-04");
  const frogPlan = dossierA.verificationPlans.find((p) => p.lab.id === labs.frog.id);
  assert.equal(frogPlan.planHistory.length, 2);
  assert.equal(frogPlan.planHistory[1].revisionReason, "评审要求加入批次平衡");
  assert.deepEqual(
    dossierA.unresolvedCounterexamples.map((c) => c.id),
    ["cx-2"],
  );
  assert.ok(dossierA.auditTrail.some((e) => e.type === "undertaking.paused"));

  // 12. 公开门槛：数据授权与署名范围都通过后才允许公开
  assert.throws(() => svc.publishHypothesis({ hypothesisId: hypA.id }), /数据授权、署名范围/);
  svc.approveDataUse({ hypothesisId: hypA.id, approver: "数据委员会", scope: "汇总统计可公开" });
  svc.approveAttribution({
    hypothesisId: hypA.id,
    approver: "联合体秘书处",
    scope: "全部参与实验室共同署名",
  });
  svc.publishHypothesis({ hypothesisId: hypA.id });
  assert.equal(svc.getHypothesis(hypA.id).status, "published");

  // 13. 主张 B：恢复后复现失败，仍计入贡献；综合判断呈现未完成证据
  svc.resumeUndertaking({ undertakingId: claimGland.id });
  svc.submitMeasurements({
    undertakingId: claimGland.id,
    conclusion: "inconclusive",
    rawHash: sha256("gland-raw-slides"),
    summary: {
      notes: "复现失败：染色批次污染",
      measurements: [{ subject: "pred-1", observed: "染色失败，无法判定" }],
    },
  });
  svc.unblindHypothesis({ hypothesisId: hypB.id });
  const synthesisB = svc.getSynthesis(hypB.id);
  assert.equal(synthesisB.verdict, "unresolved");
  assert.equal(synthesisB.incomplete.length, 1);
  assert.equal(synthesisB.incomplete[0].type, "inconclusive_submission");

  // 14. 贡献台账：负结果与失败复现都计入
  const ledger = svc.contributionLedger();
  assert.equal(ledger.find((e) => e.labId === labs.frog.id).refutes, 1);
  assert.equal(ledger.find((e) => e.labId === labs.gland.id).inconclusive, 1);

  // 15. 审计日志：从提出到公开的关键事件齐全
  const types = svc.auditLog().map((e) => e.type);
  for (const expected of [
    "hypothesis.proposed",
    "undertaking.claimed",
    "preregistration.frozen",
    "preregistration.revised",
    "undertaking.paused",
    "undertaking.resumed",
    "submission.received",
    "hypothesis.unblinded",
    "hypothesis.published",
  ]) {
    assert.ok(types.includes(expected), `缺少审计事件: ${expected}`);
  }
});
