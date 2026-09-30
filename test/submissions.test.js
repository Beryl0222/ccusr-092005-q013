import assert from "node:assert/strict";
import test from "node:test";

import { HASH_A, HASH_B, HYP_A, makeService, registerLabs } from "./helpers.js";

async function twoClaimedUndertakings() {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  const claims = [labs.joint, labs.frog].map((lab) =>
    svc.claimHypothesis({ hypothesisId: hyp.id, labId: lab.id }),
  );
  for (const claim of claims) {
    svc.freezePreregistration({
      undertakingId: claim.id,
      keySteps: ["取样", "建库"],
      primaryEndpoints: ["模块得分差值"],
    });
    svc.beginExperiment({ undertakingId: claim.id });
  }
  return { svc, labs, hyp, claims };
}

function submissionInput(undertakingId, conclusion, rawHash, observed) {
  return {
    undertakingId,
    conclusion,
    rawHash,
    summary: { measurements: [{ subject: "pred-1", observed }] },
  };
}

test("互不可见阶段实验室只能看到自己的提交，解盲后全部可见", async () => {
  const { svc, labs, hyp, claims } = await twoClaimedUndertakings();
  svc.submitMeasurements(submissionInput(claims[0].id, "supports", HASH_A, "得分 2.3 倍"));
  svc.submitMeasurements(submissionInput(claims[1].id, "refutes", HASH_B, "无显著差异"));

  // 盲态：各自只能看到自己
  assert.equal(svc.listSubmissions(hyp.id, { requestingLabId: labs.joint.id }).length, 1);
  assert.equal(
    svc.listSubmissions(hyp.id, { requestingLabId: labs.joint.id })[0].labId,
    labs.joint.id,
  );
  assert.equal(svc.listSubmissions(hyp.id, { requestingLabId: labs.frog.id }).length, 1);
  assert.equal(svc.listSubmissions(hyp.id).length, 0);

  svc.unblindHypothesis({ hypothesisId: hyp.id });
  const all = svc.listSubmissions(hyp.id, { requestingLabId: labs.joint.id });
  assert.equal(all.length, 2);
  // 解盲后允许结论相反
  assert.deepEqual(
    all.map((s) => s.conclusion).sort(),
    ["refutes", "supports"],
  );
});

test("原始材料哈希必须是 64 位十六进制", async () => {
  const { svc, claims } = await twoClaimedUndertakings();
  assert.throws(
    () =>
      svc.submitMeasurements(submissionInput(claims[0].id, "supports", "not-a-hash", "x")),
    /哈希/,
  );
  const ok = svc.submitMeasurements(
    submissionInput(claims[0].id, "supports", `sha256:${HASH_A}`, "x"),
  );
  assert.equal(ok.rawHash, `sha256:${HASH_A}`);
});

test("未开始实验不能提交测量", async () => {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  assert.throws(
    () => svc.submitMeasurements(submissionInput(claim.id, "supports", HASH_A, "x")),
    /进行中/,
  );
});

test("测量必须指向主张中的预测或反例", async () => {
  const { svc, claims } = await twoClaimedUndertakings();
  const input = submissionInput(claims[0].id, "supports", HASH_A, "x");
  input.summary = { measurements: [{ subject: "pred-9", observed: "x" }] };
  assert.throws(() => svc.submitMeasurements(input), /未知的预测或反例/);
});

test("存在未提交且未暂停的任务时不能解盲", async () => {
  const { svc, hyp, claims } = await twoClaimedUndertakings();
  svc.submitMeasurements(submissionInput(claims[0].id, "supports", HASH_A, "得分更高"));
  assert.throws(() => svc.unblindHypothesis({ hypothesisId: hyp.id }), /未提交且未暂停/);
});

test("解盲后不能再提交测量", async () => {
  const { svc, hyp, claims } = await twoClaimedUndertakings();
  svc.submitMeasurements(submissionInput(claims[0].id, "supports", HASH_A, "得分更高"));
  svc.submitMeasurements(submissionInput(claims[1].id, "refutes", HASH_B, "无差异"));
  svc.unblindHypothesis({ hypothesisId: hyp.id });
  assert.throws(
    () => svc.submitMeasurements(submissionInput(claims[0].id, "supports", HASH_A, "补交")),
    /已解盲/,
  );
});

test("没有验证任务或没有任何提交时不能解盲", async () => {
  const svc = await makeService();
  registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  assert.throws(() => svc.unblindHypothesis({ hypothesisId: hyp.id }), /没有验证任务/);
});
