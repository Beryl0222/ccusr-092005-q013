import assert from "node:assert/strict";
import test from "node:test";

import { HYP_A, HYP_B, makeService, registerLabs } from "./helpers.js";

async function serviceWithHypothesis() {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  return { svc, labs, hyp };
}

test("能力不足的实验室不能认领", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  assert.throws(
    () => svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.spongeOnly.id }),
    /不具备认领条件.*缺少样本: 青蛙/,
  );
});

test("多个实验室可以并发认领同一主张", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const [a, b] = await Promise.all([
    svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id }),
    svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.frog.id }),
  ]);
  assert.notEqual(a.id, b.id);
  assert.equal(a.status, "claimed");
  assert.equal(b.status, "claimed");
});

test("同一实验室重复认领同一主张被拒绝", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  assert.throws(
    () => svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id }),
    /已认领/,
  );
});

test("实验开始前必须冻结关键步骤与主要终点", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  assert.throws(() => svc.beginExperiment({ undertakingId: claim.id }), /冻结/);
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样", "建库", "测序"],
    primaryEndpoints: ["模块得分差值"],
  });
  const started = svc.beginExperiment({ undertakingId: claim.id });
  assert.equal(started.status, "in_progress");
});

test("预注册修订必须说明理由并保留版本历史", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样", "建库"],
    primaryEndpoints: ["模块得分差值"],
  });
  assert.throws(
    () =>
      svc.revisePreregistration({
        undertakingId: claim.id,
        keySteps: ["取样"],
        primaryEndpoints: ["模块得分差值"],
      }),
    /说明理由/,
  );
  const v2 = svc.revisePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样", "批次平衡", "建库"],
    primaryEndpoints: ["模块得分差值"],
    reason: "评审要求加入批次平衡",
  });
  assert.equal(v2.version, 2);
  const dossier = svc.getClaimDossier(hyp.id);
  const plan = dossier.verificationPlans.find((p) => p.undertakingId === claim.id);
  assert.equal(plan.planHistory.length, 2);
  assert.equal(plan.currentPlan.version, 2);
  assert.equal(plan.planHistory[0].revisionReason, null);
});

test("暂停只允许法定类别且必须解释，启动依据不被删除", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样"],
    primaryEndpoints: ["模块得分差值"],
  });
  svc.beginExperiment({ undertakingId: claim.id });

  assert.throws(
    () => svc.pauseUndertaking({ undertakingId: claim.id, category: "不想做了", explanation: "x" }),
    /暂停原因/,
  );
  assert.throws(
    () =>
      svc.pauseUndertaking({ undertakingId: claim.id, category: "ethics_restriction" }),
    /解释/,
  );

  svc.pauseUndertaking({
    undertakingId: claim.id,
    category: "model_version_change",
    explanation: "UCE 发布新版本，需确认嵌入可比性",
  });

  // 启动依据仍在：主张、认领记录、预注册历史都可查
  assert.equal(svc.getHypothesis(hyp.id).status, "open");
  const dossier = svc.getClaimDossier(hyp.id);
  const plan = dossier.verificationPlans.find((p) => p.undertakingId === claim.id);
  assert.equal(plan.status, "paused");
  assert.equal(plan.planHistory.length, 1);
  assert.equal(plan.pause.category, "model_version_change");
  const eventTypes = svc.auditLog().map((e) => e.type);
  assert.ok(eventTypes.includes("undertaking.claimed"));
  assert.ok(eventTypes.includes("preregistration.frozen"));
  assert.ok(eventTypes.includes("undertaking.paused"));

  const resumed = svc.resumeUndertaking({ undertakingId: claim.id });
  assert.equal(resumed.status, "in_progress");
});

test("暂停中的任务不能提交，恢复后才可以", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样"],
    primaryEndpoints: ["模块得分差值"],
  });
  svc.beginExperiment({ undertakingId: claim.id });
  svc.pauseUndertaking({
    undertakingId: claim.id,
    category: "sample_shortage",
    explanation: "当季样本不足",
  });
  assert.throws(
    () =>
      svc.submitMeasurements({
        undertakingId: claim.id,
        conclusion: "supports",
        rawHash: "a".repeat(64),
        summary: { measurements: [{ subject: "pred-1", observed: "x" }] },
      }),
    /进行中/,
  );
});

test("已提交的任务不能暂停或修订预注册", async () => {
  const { svc, labs, hyp } = await serviceWithHypothesis();
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样"],
    primaryEndpoints: ["模块得分差值"],
  });
  svc.beginExperiment({ undertakingId: claim.id });
  svc.submitMeasurements({
    undertakingId: claim.id,
    conclusion: "supports",
    rawHash: "a".repeat(64),
    summary: { measurements: [{ subject: "pred-1", observed: "得分显著更高" }] },
  });
  assert.throws(
    () =>
      svc.pauseUndertaking({
        undertakingId: claim.id,
        category: "resource_conflict",
        explanation: "测序平台排队",
      }),
    /不能暂停/,
  );
  assert.throws(
    () =>
      svc.revisePreregistration({
        undertakingId: claim.id,
        keySteps: ["取样"],
        primaryEndpoints: ["模块得分差值"],
        reason: "事后修改",
      }),
    /修订/,
  );
});

test("四类法定暂停原因都被接受", async () => {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_B);
  const categories = [
    "ethics_restriction",
    "sample_shortage",
    "resource_conflict",
    "model_version_change",
  ];
  for (const category of categories) {
    const lab = svc.registerLab({
      name: `临时实验室-${category}`,
      capabilities: { species: ["海绵"], techniques: ["组织学"] },
    });
    const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: lab.id });
    const paused = svc.pauseUndertaking({
      undertakingId: claim.id,
      category,
      explanation: "说明",
    });
    assert.equal(paused.pauseReason.category, category);
  }
  assert.ok(labs.gland.id);
});
