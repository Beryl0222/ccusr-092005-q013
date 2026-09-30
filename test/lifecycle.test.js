import assert from "node:assert/strict";
import test from "node:test";

import { loadCatalog } from "../src/catalog.js";
import { Hub } from "../src/hub.js";
import { MemoryEventStore } from "../src/store.js";
import { DomainError } from "../src/errors.js";
import { hashRawMaterial } from "../src/hub.js";

async function freshHub() {
  const catalog = await loadCatalog();
  return new Hub({ catalog, store: new MemoryEventStore() });
}

const NEUROID_PROPOSAL = {
  findingId: "finding-uce17-neuroid-gland",
  title: "neuroid 细胞执行腺体分泌功能而非神经传导",
  cellSet: ["dataset-sponge-neuroid"],
  predictions: [
    "原位杂交显示 neuroid 高表达分泌囊泡标志，且不表达突触释放核心基因",
    "光刺激或机械刺激下 neuroid 不产生可传导的动作电位样信号",
  ],
  falsifiers: [
    "若 neuroid 出现快速、可向邻近细胞传导的钙波且伴随突触前囊泡释放，则腺体主张被反驳",
  ],
  actor: "comp-bio-team",
};

test("完整生命周期：真实 UCE 发现成案→并发认领→修订冻结→暂停恢复→盲态提交→解盲→相反结论→闸门→公开追溯", async () => {
  const hub = await freshHub();

  // 1. 从现有 UCE 运行提出可反驳假设
  const h = hub.proposeHypothesis(NEUROID_PROPOSAL);
  assert.equal(h.source.runId, "embedding-run-uce-17");
  assert.equal(h.source.modelVersion, "uce-v4.2.1");
  assert.equal(h.version, 1);

  // 2. 两个具备能力的实验室独立并发认领（针对同一版本）
  hub.claim(h.id, {
    labId: "lab-shanghai",
    sampleCapability: "海绵活体显微钙成像",
    technicalCapability: "smFISH + 电生理",
  });
  hub.claim(h.id, {
    labId: "lab-berlin",
    sampleCapability: "海绵新鲜组织解离与流式分选",
    technicalCapability: "单细胞 ATAC + 分泌组质谱",
  });
  const claimed = hub.getHypothesis(h.id);
  assert.equal(claimed.claims.length, 2);
  assert.equal(claimed.claims[0].claimVersion, "uce-v4.2.1@embedding-run-uce-17");

  // 重复认领被拒绝
  assert.throws(
    () => hub.claim(h.id, { labId: "lab-shanghai", sampleCapability: "x", technicalCapability: "y" }),
    (e) => e instanceof DomainError && e.code === "ALREADY_CLAIMED",
  );

  // 3. 预注册 + 冻结前修订（修订留痕）
  hub.submitPreregistration(h.id, {
    labId: "lab-shanghai",
    keySteps: ["固定组织 smFISH 面板检测", "活体 GCaMP 钙成像"],
    primaryEndpoints: ["突触基因阳性细胞比例", "钙波传导速度"],
  });
  hub.revisePreregistration(h.id, {
    labId: "lab-shanghai",
    primaryEndpoints: ["突触基因阳性细胞比例", "钙波传导速度", "囊泡胞吐事件率"],
    rationale: "预实验显示需要显式测量分泌活性以区分腺体与神经表型",
  });
  hub.freezeProtocol(h.id, { labId: "lab-shanghai" });

  hub.submitPreregistration(h.id, {
    labId: "lab-berlin",
    keySteps: ["神经/腺体标志基因分选", "分泌蛋白质组定量"],
    primaryEndpoints: ["神经标志富集度", "分泌肽段丰度"],
  });
  hub.freezeProtocol(h.id, { labId: "lab-berlin" });
  assert.equal(hub.getHypothesis(h.id).amendments, 1);

  // 冻结后改写关键步骤被拒
  assert.throws(
    () =>
      hub.revisePreregistration(h.id, {
        labId: "lab-shanghai",
        keySteps: ["换一个完全不同的实验"],
        rationale: "想改",
      }),
    (e) => e instanceof DomainError && e.code === "PROTOCOL_FROZEN",
  );

  // 4. 上海实验室因伦理审批暂停、说明后恢复——暂停不删除任何依据
  hub.pauseExperiment(h.id, {
    labId: "lab-shanghai",
    reason: "ethics",
    explanation: "活体成像方案需补交动物福利审查，等待伦理委员会批复",
  });
  const paused = hub.viewFor(h.id, "lab-berlin");
  assert.equal(paused.blinded, true);
  assert.equal(paused.claims.find((c) => c.labId === "lab-shanghai").executionStatus, "paused");
  // 暂停期间认领与冻结方案仍在
  assert.ok(paused.claims.find((c) => c.labId === "lab-shanghai").frozen);

  hub.resumeExperiment(h.id, { labId: "lab-shanghai", explanation: "伦理批复编号 IACUC-2026-118" });

  // 5. 互不可见阶段提交：柏林支持、上海反驳
  hub.submitBlind(h.id, {
    labId: "lab-berlin",
    summary: { secretionPeptides: 42, synapticMarkers: 0, note: "分泌组显著、无突触信号" },
    rawDataHash: hashRawMaterial(Buffer.from("berlin-raw-data")),
    conclusionDirection: "supports",
  });

  // 柏林提交后，上海看不到其摘要与哈希，只看到“已提交”
  const shanghaiView = hub.viewFor(h.id, "lab-shanghai");
  const berlinAsSeen = shanghaiView.claims.find((c) => c.labId === "lab-berlin");
  assert.equal(berlinAsSeen.submission.blinded, true);
  assert.equal(berlinAsSeen.submission.summary, undefined);

  hub.submitBlind(h.id, {
    labId: "lab-shanghai",
    summary: { calciumWaveVelocity: 18, vesicleRelease: true, note: "记录到快速可传导钙波" },
    rawDataHash: hashRawMaterial(Buffer.from("shanghai-raw-data")),
    conclusionDirection: "refutes",
  });

  // 6. 解盲：相反结论都被允许呈现
  hub.unseal(h.id);
  const afterUnseal = hub.viewFor(h.id, "lab-shanghai");
  assert.equal(afterUnseal.blinded, false);
  assert.ok(afterUnseal.claims.find((c) => c.labId === "lab-berlin").submission.summary);

  const synth = hub.synthesis(h.id);
  assert.equal(synth.evidence.supporting.length, 1);
  assert.equal(synth.evidence.refuting.length, 1);
  assert.equal(synth.hasOpposingConclusions, true);

  // 上海的反驳（负结果）计入贡献
  const negContribution = synth.contributions.find((c) => c.labId === "lab-shanghai");
  assert.equal(negContribution.kind, "negative_result");

  // 7. 反例登记（未决），综合判断必须带出
  const ceId = hub.raiseCounterexample(h.id, {
    labId: "lab-shanghai",
    description: "约 12 μm/s 的传导钙波满足预注册反例条件",
  });

  // 8. 闸门：授权与署名未齐时禁止公开
  assert.throws(() => hub.publish(h.id), (e) => e.code === "GATE_BLOCKED");

  hub.grantDataAuthorization(h.id, { labId: "lab-shanghai", scope: "钙成像原始视频可于受控访问库使用" });
  hub.grantDataAuthorization(h.id, { labId: "lab-berlin", scope: "分泌组质谱原始谱图受控访问" });
  assert.throws(() => hub.publish(h.id), (e) => e.code === "GATE_BLOCKED");

  hub.approveAuthorship(h.id, { labId: "lab-shanghai", scope: "共同一作，负责成像实验" });
  hub.approveAuthorship(h.id, { labId: "lab-berlin", scope: "共同一作，负责分泌组实验" });

  const gating = hub.gatingStatus(h.id);
  assert.equal(gating.dataReady, true);
  assert.equal(gating.authorshipReady, true);
  assert.equal(gating.openCounterexamples, 1);

  // 未决反例不阻止公开（综合判断中同时呈现），但可追溯
  hub.publish(h.id, { actor: "steering-committee" });

  // 9. 公开追溯：方案、团队、版本关系、未决反例全部可查
  const trace = hub.trace(h.id);
  assert.equal(trace.versionLineage.claimedAgainst, "uce-v4.2.1");
  assert.equal(trace.versionLineage.preregistrationAmendments, 1);
  assert.equal(trace.teams.length, 2);
  assert.ok(trace.teams[0].frozenProtocol.primaryEndpoints.includes("囊泡胞吐事件率"));
  assert.equal(trace.unresolvedCounterexamples.length, 1);
  assert.equal(trace.unresolvedCounterexamples[0].id, ceId);
  // 事件日志完整保留（含暂停/恢复）
  const types = trace.eventLog.map((e) => e.type);
  assert.ok(types.includes("ExperimentPaused"));
  assert.ok(types.includes("SubmissionUnsealed"));

  // 反例处理后从未决清单移除，但仍在事件历史里
  hub.resolveCounterexample(h.id, { counterexampleId: ceId, resolution: "判定钙波为上皮传导而非神经传导，不构成神经功能反例，转入后续假设" });
  assert.equal(hub.trace(h.id).unresolvedCounterexamples.length, 0);
});
