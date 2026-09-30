import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../src/catalog.js";
import { DomainError } from "../src/errors.js";

test("目录加载真实海绵数据集与两次 UCE 运行及其发现", async () => {
  const catalog = await loadCatalog();
  assert.ok(catalog.datasets.has("dataset-sponge-choanocyte"));
  assert.ok(catalog.datasets.has("dataset-sponge-neuroid"));
  assert.ok(catalog.datasets.has("frog-neuron-08"));

  const run = catalog.getRun("embedding-run-uce-17");
  assert.equal(run.model_version, "uce-v4.2.1");

  const choanoFinding = catalog.getFinding("finding-uce17-choano-neuron");
  assert.deepEqual(choanoFinding.cell_set, ["dataset-sponge-choanocyte", "frog-neuron-08"]);
  assert.equal(choanoFinding.runId, "embedding-run-uce-17");

  const neuroidFinding = catalog.getFinding("finding-uce17-neuroid-gland");
  assert.equal(neuroidFinding.modelVersion, "uce-v4.2.1");
});

test("目录拒绝引用输入范围之外数据集的发现", async () => {
  const catalog = await loadCatalog();
  await assert.rejects(
    async () => catalog.getRun("不存在"),
    (error) => error instanceof DomainError && error.code === "UNKNOWN_RUN",
  );
});
