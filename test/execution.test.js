import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../src/catalog.js";
import { Hub, hashRawMaterial } from "../src/hub.js";
import { MemoryEventStore } from "../src/store.js";
import { DomainError } from "../src/errors.js";

async function setupClaim(labId = "lab-a") {
  const catalog = await loadCatalog();
  const hub = new Hub({ catalog, store: new MemoryEventStore() });
  const h = hub.proposeHypothesis({
    findingId: "finding-uce18-neuroid-revisit",
    title: "neuroid 归属对模型版本敏感",
    cellSet: ["dataset-sponge-neuroid"],
    predictions: ["换版后神经样标志得分回升可在独立数据中复现"],
    falsifiers: ["独立数据中神经样标志得分无回升且腺体标志持续占优"],
  });
  hub.claim(h.id, { labId, sampleCapability: "s", technicalCapability: "t" });
  hub.submitPreregistration(h.id, {
    labId,
    keySteps: ["步骤一"],
    primaryEndpoints: ["终点一"],
  });
  return { hub, id: h.id, labId };
}

test("暂停原因限定为四类且必须解释；暂停不能删除启动依据", async () => {
  const { hub, id, labId } = await setupClaim();
  hub.freezeProtocol(id, { labId });

  assert.throws(
    () => hub.pauseExperiment(id, { labId, reason: "mood", explanation: "不想做了" }),
    (e) => e.code === "BAD_PAUSE_REASON",
  );
  assert.throws(
    () => hub.pauseExperiment(id, { labId, reason: "ethics", explanation: "   " }),
    (e) => e.code === "PAUSE_WITHOUT_EXPLANATION",
  );

  hub.pauseExperiment(id, {
    labId,
    reason: "model_version_change",
    explanation: "UCE v4.3.0 换版重跑改变 neuroid 邻域，暂停以评估 v4.2.1 方案是否仍适用",
  });

  const h = hub.getHypothesis(id);
  const claim = h.claims[0];
  assert.equal(claim.executionStatus, "paused");
  assert.equal(claim.pauseCount, 1);
  // 认领、冻结状态、版本关系全部保留
  assert.equal(claim.frozen, true);
  assert.equal(claim.claimVersion, "uce-v4.3.0@embedding-run-uce-18");

  // 暂停态不能提交，恢复后才行
  assert.throws(
    () =>
      hub.submitBlind(id, {
        labId,
        summary: { x: 1 },
        rawDataHash: hashRawMaterial(Buffer.from("d")),
        conclusionDirection: "supports",
      }),
    (e) => e.code === "PAUSED",
  );
  hub.resumeExperiment(id, { labId, explanation: "评估完成，维持原方案并在解读中标注版本敏感性" });
  hub.submitBlind(id, {
    labId,
    summary: { x: 1 },
    rawDataHash: hashRawMaterial(Buffer.from("d")),
    conclusionDirection: "inconclusive",
  });
});

test("失败复现保留在台账中并归入未完成证据，不能静默删除", async () => {
  const { hub, id, labId } = await setupClaim();
  hub.freezeProtocol(id, { labId });
  hub.pauseExperiment(id, { labId, reason: "sample_shortage", explanation: "采集季海绵样本量不足" });
  hub.resumeExperiment(id, { labId, explanation: "等待下一采集季" });
  hub.failExperiment(id, { labId, reason: "sample_shortage", explanation: "整个采集季未取得足够成体海绵" });

  const synth = hub.synthesis(id);
  assert.equal(synth.evidence.unfinished.length, 1);
  assert.equal(synth.evidence.unfinished[0].reason, "failed");
  assert.deepEqual(
    synth.contributions.map((c) => c.kind),
    ["failed_replication"],
  );

  // 失败的认领历史仍可完整回放
  const h = hub.getHypothesis(id);
  assert.equal(h.claims[0].executionStatus, "failed");
  assert.ok(h.history.some((e) => e.type === "ExperimentPaused"));
  assert.ok(h.history.some((e) => e.type === "ExperimentFailed"));
});

test("未冻结不允许提交；盲态提交不可替换；哈希格式受校验", async () => {
  const { hub, id, labId } = await setupClaim();
  const payload = {
    labId,
    summary: { x: 1 },
    rawDataHash: hashRawMaterial(Buffer.from("d")),
    conclusionDirection: "supports",
  };
  assert.throws(() => hub.submitBlind(id, payload), (e) => e.code === "NOT_FROZEN");

  hub.freezeProtocol(id, { labId });
  assert.throws(
    () => hub.submitBlind(id, { ...payload, rawDataHash: "not-a-hash" }),
    (e) => e.code === "INVALID_HASH",
  );

  hub.submitBlind(id, payload);
  await assert.rejects(async () => hub.submitBlind(id, payload), (e) => e.code === "ALREADY_SUBMITTED");
});

test("解盲前要求至少一份提交；综合判断并列支持、反驳、未完成三类证据", async () => {
  const catalog = await loadCatalog();
  const hub = new Hub({ catalog, store: new MemoryEventStore() });
  const h = hub.proposeHypothesis({
    findingId: "finding-uce17-neuroid-gland",
    title: "t",
    cellSet: ["dataset-sponge-neuroid"],
    predictions: ["p"],
    falsifiers: ["f"],
  });

  for (const [labId, dir] of [["lab-s", "supports"], ["lab-r", "refutes"], ["lab-u", null]]) {
    hub.claim(h.id, { labId, sampleCapability: "s", technicalCapability: "t" });
    hub.submitPreregistration(h.id, { labId, keySteps: ["k"], primaryEndpoints: ["e"] });
    hub.freezeProtocol(h.id, { labId });
    if (dir) {
      hub.submitBlind(h.id, {
        labId,
        summary: { result: dir },
        rawDataHash: hashRawMaterial(Buffer.from(labId)),
        conclusionDirection: dir,
      });
    } else {
      hub.pauseExperiment(h.id, { labId, reason: "resource_conflict", explanation: "质谱机时被收回" });
    }
  }

  // 指定了尚未提交的实验室时解盲被拒
  assert.throws(
    () => hub.unseal(h.id, { expectedLabIds: ["lab-s", "lab-r", "lab-u"] }),
    (e) => e.code === "NOT_ALL_SUBMITTED",
  );
  hub.unseal(h.id, { expectedLabIds: ["lab-s", "lab-r"] });

  const synth = hub.synthesis(h.id);
  assert.equal(synth.evidence.supporting.length, 1);
  assert.equal(synth.evidence.refuting.length, 1);
  assert.equal(synth.evidence.unfinished.length, 1);
  assert.equal(synth.evidence.unfinished[0].reason, "paused");
});

test("撤销任一参与方的数据授权或署名审批都会重新关闭公开闸门", async () => {
  const catalog = await loadCatalog();
  const hub = new Hub({ catalog, store: new MemoryEventStore() });
  const h = hub.proposeHypothesis({
    findingId: "finding-uce17-neuroid-gland",
    title: "t",
    cellSet: ["dataset-sponge-neuroid"],
    predictions: ["p"],
    falsifiers: ["f"],
  });
  hub.claim(h.id, { labId: "lab-a", sampleCapability: "s", technicalCapability: "t" });
  hub.submitPreregistration(h.id, { labId: "lab-a", keySteps: ["k"], primaryEndpoints: ["e"] });
  hub.freezeProtocol(h.id, { labId: "lab-a" });
  hub.submitBlind(h.id, {
    labId: "lab-a",
    summary: { ok: true },
    rawDataHash: hashRawMaterial(Buffer.from("a")),
    conclusionDirection: "supports",
  });
  hub.unseal(h.id);
  hub.grantDataAuthorization(h.id, { labId: "lab-a", scope: "受控访问" });
  hub.approveAuthorship(h.id, { labId: "lab-a", scope: "作者" });
  hub.publish(h.id);

  hub.revokeDataAuthorization(h.id, { labId: "lab-a" });
  // 已发布事实不可删除，但闸门状态如实反映当前未满足
  const gating = hub.gatingStatus(h.id);
  assert.equal(gating.dataReady, false);
  assert.equal(gating.publicationStatus, "published");
  // 重新发布被拒（追加事件也无法抹掉此前发布记录）
  assert.throws(() => hub.publish(h.id), (e) => e.code === "GATE_BLOCKED");
});
