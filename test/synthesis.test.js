import assert from "node:assert/strict";
import test from "node:test";

import { HASH_A, HASH_B, HASH_C, HYP_A, makeService, registerLabs } from "./helpers.js";

async function setup() {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  const claimOf = (lab) => {
    const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: lab.id });
    svc.freezePreregistration({
      undertakingId: claim.id,
      keySteps: ["取样", "建库"],
      primaryEndpoints: ["模块得分差值"],
    });
    svc.beginExperiment({ undertakingId: claim.id });
    return claim;
  };
  return { svc, labs, hyp, claimOf };
}

test("综合判断同时呈现支持、反驳与未完成证据，相反结论判为 contested", async () => {
  const { svc, labs, hyp, claimOf } = await setup();
  const c1 = claimOf(labs.joint);
  const c2 = claimOf(labs.frog);
  // 第三个实验室认领后暂停 → 未完成证据
  const third = svc.registerLab({
    name: "深海基因组实验室",
    capabilities: { species: ["海绵", "青蛙"], techniques: ["scRNA-seq"] },
  });
  const c3 = svc.claimHypothesis({ hypothesisId: hyp.id, labId: third.id });
  svc.pauseUndertaking({
    undertakingId: c3.id,
    category: "resource_conflict",
    explanation: "测序平台被其他项目占用",
  });

  svc.submitMeasurements({
    undertakingId: c1.id,
    conclusion: "supports",
    rawHash: HASH_A,
    summary: {
      measurements: [
        { subject: "pred-1", observed: "模块得分 2.3 倍于其他细胞类型" },
        { subject: "cx-1", observed: "差异显著，反例未触发" },
      ],
    },
  });
  svc.submitMeasurements({
    undertakingId: c2.id,
    conclusion: "refutes",
    rawHash: HASH_B,
    summary: { measurements: [{ subject: "pred-1", observed: "模块得分无显著差异" }] },
  });

  svc.unblindHypothesis({ hypothesisId: hyp.id });
  const synthesis = svc.getSynthesis(hyp.id);
  assert.equal(synthesis.verdict, "contested");
  assert.equal(synthesis.supporting.length, 1);
  assert.equal(synthesis.refuting.length, 1);
  // 未完成证据：暂停的任务
  assert.equal(synthesis.incomplete.length, 1);
  assert.equal(synthesis.incomplete[0].type, "paused_undertaking");
  assert.equal(synthesis.incomplete[0].reason.category, "resource_conflict");
});

test("失败复现以 inconclusive 进入未完成证据", async () => {
  const { svc, labs, hyp, claimOf } = await setup();
  const c1 = claimOf(labs.joint);
  svc.submitMeasurements({
    undertakingId: c1.id,
    conclusion: "inconclusive",
    rawHash: HASH_C,
    summary: {
      notes: "复现失败：建库批次污染",
      measurements: [{ subject: "pred-1", observed: "无法判定" }],
    },
  });
  svc.unblindHypothesis({ hypothesisId: hyp.id });
  const synthesis = svc.getSynthesis(hyp.id);
  assert.equal(synthesis.verdict, "unresolved");
  assert.equal(synthesis.supporting.length, 0);
  assert.equal(synthesis.refuting.length, 0);
  assert.equal(synthesis.incomplete[0].type, "inconclusive_submission");
});

test("盲态下不能形成综合判断", async () => {
  const { svc, hyp } = await setup();
  assert.throws(() => svc.getSynthesis(hyp.id), /解盲/);
});

test("尚未解决的反例按可见提交中的测量计算", async () => {
  const { svc, labs, hyp, claimOf } = await setup();
  const c1 = claimOf(labs.joint);
  svc.submitMeasurements({
    undertakingId: c1.id,
    conclusion: "supports",
    rawHash: HASH_A,
    summary: { measurements: [{ subject: "cx-1", observed: "反例未触发" }] },
  });
  svc.unblindHypothesis({ hypothesisId: hyp.id });
  const dossier = svc.getClaimDossier(hyp.id);
  assert.deepEqual(
    dossier.unresolvedCounterexamples.map((c) => c.id),
    ["cx-2"],
  );
});

test("负结果与失败复现都计入贡献台账", async () => {
  const { svc, labs, hyp, claimOf } = await setup();
  const c1 = claimOf(labs.joint);
  const c2 = claimOf(labs.frog);
  svc.submitMeasurements({
    undertakingId: c1.id,
    conclusion: "refutes",
    rawHash: HASH_A,
    summary: { measurements: [{ subject: "pred-1", observed: "无差异（负结果）" }] },
  });
  svc.submitMeasurements({
    undertakingId: c2.id,
    conclusion: "inconclusive",
    rawHash: HASH_B,
    summary: { notes: "复现失败", measurements: [{ subject: "pred-1", observed: "无法判定" }] },
  });
  const ledger = svc.contributionLedger();
  const joint = ledger.find((e) => e.labId === labs.joint.id);
  const frog = ledger.find((e) => e.labId === labs.frog.id);
  assert.equal(joint.submissions, 1);
  assert.equal(joint.refutes, 1);
  assert.equal(frog.submissions, 1);
  assert.equal(frog.inconclusive, 1);
  assert.equal(joint.undertakings, 1);
});
