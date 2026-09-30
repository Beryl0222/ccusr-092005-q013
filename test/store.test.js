import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";

import { loadCatalog } from "../src/catalog.js";
import { Hub, hashRawMaterial } from "../src/hub.js";
import { JsonlEventStore } from "../src/store.js";

test("JsonlEventStore 重启回放：暂停、修订、盲态提交与发布依据全部保留", async () => {
  const file = "data/test-events.jsonl";
  rmSync(file, { force: true });

  const catalog = await loadCatalog();
  const hub = new Hub({ catalog, store: new JsonlEventStore(file) });
  const h = hub.proposeHypothesis({
    findingId: "finding-uce17-neuroid-gland",
    title: "neuroid 腺体主张",
    cellSet: ["dataset-sponge-neuroid"],
    predictions: ["分泌囊泡标志阳性"],
    falsifiers: ["出现可传导快速钙波"],
  });
  hub.claim(h.id, { labId: "lab-a", sampleCapability: "s", technicalCapability: "t" });
  hub.submitPreregistration(h.id, { labId: "lab-a", keySteps: ["k"], primaryEndpoints: ["e"] });
  hub.freezeProtocol(h.id, { labId: "lab-a" });
  hub.pauseExperiment(h.id, { labId: "lab-a", reason: "ethics", explanation: "等待伦理批复" });
  hub.resumeExperiment(h.id, { labId: "lab-a", explanation: "批复通过" });
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

  // 模拟进程重启：新建存储从同一文件回放
  const hub2 = new Hub({ catalog, store: new JsonlEventStore(file) });
  const restored = hub2.getHypothesis(h.id);
  assert.equal(restored.claims[0].executionStatus, "submitted");
  assert.equal(restored.claims[0].pauseCount, 1);
  assert.equal(restored.publicationStatus, "published");

  const trace = hub2.trace(h.id);
  assert.equal(trace.teams[0].submission.conclusionDirection, "supports");
  assert.ok(trace.eventLog.some((e) => e.type === "ExperimentPaused"));

  rmSync(file, { force: true });
});
