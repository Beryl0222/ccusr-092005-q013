import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../src/catalog.js";
import { Hub } from "../src/hub.js";
import { MemoryEventStore } from "../src/store.js";
import { DomainError } from "../src/errors.js";

async function freshHub() {
  const catalog = await loadCatalog();
  return new Hub({ catalog, store: new MemoryEventStore() });
}

test("假设必须源自目录中真实完成的分析运行与发现", async () => {
  const hub = await freshHub();
  const catalog = await loadCatalog();
  const base = {
    title: "t",
    cellSet: ["dataset-sponge-choanocyte", "frog-neuron-08"],
    predictions: ["p"],
    falsifiers: ["f"],
  };

  await assert.throws(
    () => hub.proposeHypothesis({ ...base, findingId: "finding-ghost" }),
    (e) => e instanceof DomainError && e.code === "UNKNOWN_FINDING",
  );

  await assert.throws(
    () =>
      hub.proposeHypothesis({
        ...base,
        findingId: "finding-uce17-choano-neuron",
        runId: "embedding-run-uce-18",
      }),
    (e) => e.code === "FINDING_RUN_MISMATCH",
  );

  // 细胞集合必须在来源运行的输入范围内（用缩小输入范围的目录存根构造）
  const narrowCatalog = {
    getFinding: () => catalog.getFinding("finding-uce17-choano-neuron"),
    getRun: () => ({
      id: "embedding-run-uce-17",
      state: "completed",
      model: "UCE",
      model_version: "uce-v4.2.1",
      datasets: ["dataset-sponge-choanocyte", "frog-neuron-08"],
    }),
    getDataset: (id) => catalog.getDataset(id),
  };
  const narrowHub = new Hub({ catalog: narrowCatalog, store: new MemoryEventStore() });
  assert.throws(
    () =>
      narrowHub.proposeHypothesis({
        ...base,
        findingId: "finding-uce17-choano-neuron",
        cellSet: ["dataset-sponge-neuroid"],
      }),
    (e) => e.code === "CELL_SET_OUTSIDE_RUN",
  );

  // 没有反例条件的“吸引人阳性结果”不能成案
  assert.throws(
    () =>
      hub.proposeHypothesis({
        findingId: "finding-uce17-choano-neuron",
        title: "领细胞就是神经元",
        cellSet: ["dataset-sponge-choanocyte"],
        predictions: ["总会更像"],
        falsifiers: [],
      }),
    (e) => e.code === "EMPTY_FALSIFIERS",
  );
});

test("乐观并发控制：基于过期版本的并发认领修改被拒绝", async () => {
  const hub = await freshHub();
  const h = hub.proposeHypothesis({
    findingId: "finding-uce17-choano-neuron",
    title: "领细胞具备神经元样调控程序",
    cellSet: ["dataset-sponge-choanocyte", "frog-neuron-08"],
    predictions: ["共享调控模块在分化轨迹中保守激活"],
    falsifiers: ["跨物种差异表达分析中该模块富集不超过随机基因集"],
  });

  hub.claim(h.id, { labId: "lab-a", sampleCapability: "s", technicalCapability: "t" });
  // 直接对存储用过期版本 1 追加第二个实验室的认领事件
  assert.throws(
    () =>
      hub.store.append(
        {
          eventId: "x",
          aggregateId: h.id,
          type: "ClaimMade",
          payload: { labId: "lab-b", version: "v" },
          actor: "lab-b",
          at: new Date().toISOString(),
        },
        1,
      ),
    (e) => e.code === "CONFLICT",
  );
  // 经正常命令仍可认领——并发实验室不会因冲突丢失资格
  hub.claim(h.id, { labId: "lab-b", sampleCapability: "s2", technicalCapability: "t2" });
  assert.equal(hub.getHypothesis(h.id).claims.length, 2);
});

test("认领必须声明样本与技术能力", async () => {
  const hub = await freshHub();
  const h = hub.proposeHypothesis({
    findingId: "finding-uce17-choano-neuron",
    title: "t",
    cellSet: ["dataset-sponge-choanocyte", "frog-neuron-08"],
    predictions: ["p"],
    falsifiers: ["f"],
  });
  assert.throws(
    () => hub.claim(h.id, { labId: "lab-x" }),
    (e) => e.code === "CAPABILITY_UNDECLARED",
  );
});
