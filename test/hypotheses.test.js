import assert from "node:assert/strict";
import test from "node:test";

import { HYP_A, makeService } from "./helpers.js";

test("现有海绵数据集与 UCE 运行可以作为真实假设来源", async () => {
  const svc = await makeService();
  const hyp = svc.proposeHypothesis(HYP_A);
  assert.equal(hyp.source.recordId, "embedding-run-uce-17");
  assert.equal(hyp.source.model, "UCE");
  assert.deepEqual(
    hyp.source.datasets.map((d) => d.id),
    ["dataset-sponge-choanocyte", "frog-neuron-08"],
  );
  assert.equal(hyp.source.datasets[0].geneMapVersion, "ortholog-2026-04");
  assert.deepEqual(
    hyp.predictions.map((p) => p.id),
    ["pred-1"],
  );
  assert.deepEqual(
    hyp.counterexamples.map((c) => c.id),
    ["cx-1", "cx-2"],
  );
  assert.equal(hyp.blinded, true);
  assert.equal(hyp.status, "open");
});

test("未知来源记录被拒绝", async () => {
  const svc = await makeService();
  assert.throws(
    () => svc.proposeHypothesis({ ...HYP_A, sourceRecordId: "run-not-exist" }),
    /来源记录不存在/,
  );
});

test("缺少反例条件的主张不可提出（必须可被反驳）", async () => {
  const svc = await makeService();
  assert.throws(() => svc.proposeHypothesis({ ...HYP_A, counterexamples: [] }), /反例条件/);
});

test("缺少预测现象或细胞集合的主张不可提出", async () => {
  const svc = await makeService();
  assert.throws(() => svc.proposeHypothesis({ ...HYP_A, predictions: [] }), /预测现象/);
  assert.throws(() => svc.proposeHypothesis({ ...HYP_A, cellSets: [] }), /细胞集合/);
});

test("细胞集合引用未知数据集被拒绝", async () => {
  const svc = await makeService();
  assert.throws(
    () =>
      svc.proposeHypothesis({
        ...HYP_A,
        cellSets: [{ datasetId: "ghost-dataset" }],
      }),
    /未知数据集/,
  );
});

test("未提供能力需求时按细胞集合物种推导", async () => {
  const svc = await makeService();
  const { requiredCapabilities, ...rest } = HYP_A;
  const hyp = svc.proposeHypothesis({ ...rest, cellSets: [HYP_A.cellSets[0]] });
  assert.deepEqual(hyp.requiredCapabilities, { species: ["海绵"], techniques: [] });
});
