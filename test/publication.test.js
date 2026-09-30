import assert from "node:assert/strict";
import test from "node:test";

import { HASH_A, HYP_A, makeService, registerLabs } from "./helpers.js";

async function unblindedHypothesis() {
  const svc = await makeService();
  const labs = registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  const claim = svc.claimHypothesis({ hypothesisId: hyp.id, labId: labs.joint.id });
  svc.freezePreregistration({
    undertakingId: claim.id,
    keySteps: ["取样", "建库"],
    primaryEndpoints: ["模块得分差值"],
  });
  svc.beginExperiment({ undertakingId: claim.id });
  svc.submitMeasurements({
    undertakingId: claim.id,
    conclusion: "supports",
    rawHash: HASH_A,
    summary: { measurements: [{ subject: "pred-1", observed: "得分显著更高" }] },
  });
  svc.unblindHypothesis({ hypothesisId: hyp.id });
  return { svc, hyp };
}

test("数据授权与署名范围都通过后才允许公开", async () => {
  const { svc, hyp } = await unblindedHypothesis();
  assert.throws(() => svc.publishHypothesis({ hypothesisId: hyp.id }), /数据授权、署名范围/);

  svc.approveDataUse({ hypothesisId: hyp.id, approver: "数据委员会", scope: "汇总统计可公开" });
  assert.throws(() => svc.publishHypothesis({ hypothesisId: hyp.id }), /署名范围/);

  svc.approveAttribution({
    hypothesisId: hyp.id,
    approver: "联合体秘书处",
    scope: "全部参与实验室共同署名",
  });
  svc.publishHypothesis({ hypothesisId: hyp.id });
  assert.equal(svc.getHypothesis(hyp.id).status, "published");

  const dossier = svc.getClaimDossier(hyp.id);
  assert.equal(dossier.publication.dataUseApproval.approver, "数据委员会");
  assert.equal(dossier.publication.attributionApproval.scope, "全部参与实验室共同署名");
  assert.ok(dossier.publication.publishedAt);
});

test("未解盲的主张不能公开", async () => {
  const svc = await makeService();
  registerLabs(svc);
  const hyp = svc.proposeHypothesis(HYP_A);
  svc.approveDataUse({ hypothesisId: hyp.id, approver: "数据委员会", scope: "全部" });
  svc.approveAttribution({ hypothesisId: hyp.id, approver: "秘书处", scope: "共同署名" });
  assert.throws(() => svc.publishHypothesis({ hypothesisId: hyp.id }), /未解盲/);
});

test("审批必须给出审批人与范围", async () => {
  const { svc, hyp } = await unblindedHypothesis();
  assert.throws(() => svc.approveDataUse({ hypothesisId: hyp.id, approver: "数据委员会" }), /授权范围/);
  assert.throws(() => svc.approveAttribution({ hypothesisId: hyp.id, scope: "共同署名" }), /审批人/);
});
