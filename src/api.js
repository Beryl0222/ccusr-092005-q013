import { DomainError } from "./errors.js";

const NOT_FOUND = new Set(["UNKNOWN_HYPOTHESIS", "UNKNOWN_DATASET", "UNKNOWN_RUN", "UNKNOWN_FINDING", "UNKNOWN_COUNTEREXAMPLE", "NOT_PUBLISHED"]);
const CONFLICT = new Set([
  "CONFLICT",
  "ALREADY_CLAIMED",
  "GATE_BLOCKED",
  "STILL_BLIND",
  "NOT_ALL_SUBMITTED",
  "PROTOCOL_FROZEN",
  "HYPOTHESIS_EXISTS",
  "ALREADY_SUBMITTED",
  "NO_AUTHORIZATION",
  "NO_AUTHORSHIP_APPROVAL",
  "COUNTEREXAMPLE_RESOLVED",
]);

function errorStatus(error) {
  if (NOT_FOUND.has(error.code)) return 404;
  if (CONFLICT.has(error.code)) return 409;
  return 400;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

async function readBody(req) {
  if (req.method === "GET") return {};
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("BAD_JSON", "请求体不是合法 JSON");
  }
}

/**
 * 构造 HTTP 适配层。hub 为已注入目录与存储的协作中枢。
 * 返回符合 request listener 签名的函数，可直接挂到 node:http 或用于测试。
 */
export function createApi(hub, catalog) {
  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  add("GET", /^\/catalog$/, () => ({
    project: catalog.project,
    datasets: [...catalog.datasets.values()],
    runs: [...catalog.runs.values()],
    findings: [...catalog.findings.values()],
  }));

  add("GET", /^\/hypotheses$/, () => ({ hypotheses: hub.listHypotheses() }));

  add("POST", /^\/hypotheses$/, (_, body) =>
    hub.proposeHypothesis({
      findingId: body.findingId,
      runId: body.runId,
      title: body.title,
      cellSet: body.cellSet,
      predictions: body.predictions,
      falsifiers: body.falsifiers,
      actor: body.actor,
      id: body.id,
    }),
  );

  // /hypotheses/:id/<action...>
  add("POST", /^\/hypotheses\/([^/]+)\/claim$/, (m, body) =>
    hub.claim(m[1], {
      labId: body.labId,
      sampleCapability: body.sampleCapability,
      technicalCapability: body.technicalCapability,
      actor: body.actor,
    }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/preregistrations$/, (m, body) =>
    hub.submitPreregistration(m[1], {
      labId: body.labId,
      keySteps: body.keySteps,
      primaryEndpoints: body.primaryEndpoints,
      samplePlan: body.samplePlan,
      techniques: body.techniques,
      actor: body.actor,
    }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/preregistrations\/revise$/, (m, body) =>
    hub.revisePreregistration(m[1], {
      labId: body.labId,
      keySteps: body.keySteps,
      primaryEndpoints: body.primaryEndpoints,
      rationale: body.rationale,
      samplePlan: body.samplePlan,
      techniques: body.techniques,
      actor: body.actor,
    }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/freeze$/, (m, body) => hub.freezeProtocol(m[1], { labId: body.labId, actor: body.actor }));
  add("POST", /^\/hypotheses\/([^/]+)\/pause$/, (m, body) =>
    hub.pauseExperiment(m[1], {
      labId: body.labId,
      reason: body.reason,
      explanation: body.explanation,
      actor: body.actor,
    }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/resume$/, (m, body) =>
    hub.resumeExperiment(m[1], { labId: body.labId, explanation: body.explanation, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/fail$/, (m, body) =>
    hub.failExperiment(m[1], { labId: body.labId, reason: body.reason, explanation: body.explanation, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/submissions$/, (m, body) =>
    hub.submitBlind(m[1], {
      labId: body.labId,
      summary: body.summary,
      rawDataHash: body.rawDataHash,
      conclusionDirection: body.conclusionDirection,
      actor: body.actor,
    }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/unseal$/, (m, body) =>
    hub.unseal(m[1], { expectedLabIds: body.expectedLabIds, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/counterexamples$/, async (m, body) => {
    const counterexampleId = await hub.raiseCounterexample(m[1], {
      labId: body.labId,
      description: body.description,
      evidence: body.evidence,
      actor: body.actor,
    });
    return { counterexampleId };
  });
  add("POST", /^\/hypotheses\/([^/]+)\/counterexamples\/([^/]+)\/resolve$/, (m, body) =>
    hub.resolveCounterexample(m[1], { counterexampleId: m[2], resolution: body.resolution, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/data-authorizations$/, (m, body) =>
    hub.grantDataAuthorization(m[1], { labId: body.labId, scope: body.scope, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/data-authorizations\/revoke$/, (m, body) =>
    hub.revokeDataAuthorization(m[1], { labId: body.labId, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/authorship-approvals$/, (m, body) =>
    hub.approveAuthorship(m[1], { labId: body.labId, scope: body.scope, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/authorship-approvals\/revoke$/, (m, body) =>
    hub.revokeAuthorship(m[1], { labId: body.labId, actor: body.actor }),
  );
  add("POST", /^\/hypotheses\/([^/]+)\/publish$/, (m, body) => hub.publish(m[1], { actor: body.actor }));

  add("GET", /^\/hypotheses\/([^/]+)$/, (m) => hub.getHypothesis(m[1]));
  add("GET", /^\/hypotheses\/([^/]+)\/synthesis$/, (m) => hub.synthesis(m[1]));
  add("GET", /^\/hypotheses\/([^/]+)\/gating$/, (m) => hub.gatingStatus(m[1]));
  add("GET", /^\/hypotheses\/([^/]+)\/trace$/, (m) => hub.trace(m[1]));
  add("GET", /^\/hypotheses\/([^/]+)\/view$/, (m, _b, url) =>
    hub.viewFor(m[1], url.searchParams.get("lab")),
  );

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, "http://localhost");
      const body = await readBody(req);
      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = url.pathname.match(route.pattern);
        if (!match) continue;
        const result = await route.handler(match, body, url);
        return json(res, 200, result ?? { ok: true });
      }
      return json(res, 404, { error: { code: "NOT_FOUND", message: `无此路由：${req.method} ${url.pathname}` } });
    } catch (error) {
      if (error instanceof DomainError) {
        return json(res, errorStatus(error), { error: { code: error.code, message: error.message, details: error.details } });
      }
      throw error;
    }
  };
}
