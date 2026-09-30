import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "node:http";

import { loadCatalog } from "../src/catalog.js";
import { Hub } from "../src/hub.js";
import { MemoryEventStore } from "../src/store.js";
import { createApi } from "../src/api.js";

let server;
let base;

before(async () => {
  const catalog = await loadCatalog();
  const hub = new Hub({ catalog, store: new MemoryEventStore() });
  server = createServer(createApi(hub, catalog));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test("HTTP：从目录发现到公开追溯的跨实验室协作流程", async () => {
  const catalog = await call("GET", "/catalog");
  assert.equal(catalog.status, 200);
  assert.ok(catalog.json.findings.some((f) => f.id === "finding-uce17-choano-neuron"));

  const proposed = await call("POST", "/hypotheses", {
    findingId: "finding-uce17-choano-neuron",
    title: "领细胞神经元样调控程序",
    cellSet: ["dataset-sponge-choanocyte", "frog-neuron-08"],
    predictions: ["分化轨迹中保守激活同一调控模块"],
    falsifiers: ["模块跨物种富集不超过随机匹配"],
  });
  assert.equal(proposed.status, 200);
  const hid = proposed.json.id;

  assert.equal((await call("POST", `/hypotheses/${hid}/claim`, { labId: "lab-a", sampleCapability: "s", technicalCapability: "t" })).status, 200);
  // 并发认领成功
  assert.equal((await call("POST", `/hypotheses/${hid}/claim`, { labId: "lab-b", sampleCapability: "s", technicalCapability: "t" })).status, 200);
  // 重复认领 → 409
  const dup = await call("POST", `/hypotheses/${hid}/claim`, { labId: "lab-a", sampleCapability: "s", technicalCapability: "t" });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, "ALREADY_CLAIMED");

  for (const lab of ["lab-a", "lab-b"]) {
    await call("POST", `/hypotheses/${hid}/preregistrations`, {
      labId: lab,
      keySteps: ["k1"],
      primaryEndpoints: ["e1"],
    });
    await call("POST", `/hypotheses/${hid}/freeze`, { labId: lab });
  }

  await call("POST", `/hypotheses/${hid}/submissions`, {
    labId: "lab-a",
    summary: { enrichment: 0.31 },
    rawDataHash: "sha256:aaaaaaaaaaaaaaaa",
    conclusionDirection: "supports",
  });

  // 盲态视角：lab-b 看不到 lab-a 的摘要
  const blind = await call("GET", `/hypotheses/${hid}/view?lab=lab-b`);
  assert.equal(blind.json.blinded, true);
  assert.equal(blind.json.claims.find((c) => c.labId === "lab-a").submission.blinded, true);

  await call("POST", `/hypotheses/${hid}/submissions`, {
    labId: "lab-b",
    summary: { enrichment: 0.02 },
    rawDataHash: "sha256:bbbbbbbbbbbbbbbb",
    conclusionDirection: "refutes",
  });
  await call("POST", `/hypotheses/${hid}/unseal`, {});

  const synth = await call("GET", `/hypotheses/${hid}/synthesis`);
  assert.equal(synth.json.evidence.supporting.length, 1);
  assert.equal(synth.json.evidence.refuting.length, 1);

  // 未发布时追溯 404 语义
  assert.equal((await call("GET", `/hypotheses/${hid}/trace`)).status, 404);

  // 闸门拦截 → 授权署名齐备 → 发布 → 追溯可查
  assert.equal((await call("POST", `/hypotheses/${hid}/publish`, {})).status, 409);
  for (const lab of ["lab-a", "lab-b"]) {
    await call("POST", `/hypotheses/${hid}/data-authorizations`, { labId: lab, scope: "受控访问" });
    await call("POST", `/hypotheses/${hid}/authorship-approvals`, { labId: lab, scope: "共同作者" });
  }
  assert.equal((await call("POST", `/hypotheses/${hid}/publish`, {})).status, 200);

  const trace = await call("GET", `/hypotheses/${hid}/trace`);
  assert.equal(trace.status, 200);
  assert.equal(trace.json.versionLineage.model, "UCE");
  assert.equal(trace.json.teams.length, 2);
  assert.equal(trace.json.unresolvedCounterexamples.length, 0);

  // 错误输入（非法哈希）→ 400
  const bad = await call("POST", `/hypotheses/${hid}/claim`, {});
  assert.equal(bad.status, 400);
});
