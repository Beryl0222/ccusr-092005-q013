import { fail } from "./errors.js";
import { assertCapabilities } from "./labs.js";
import { mustHypothesis, mustLab, mustUndertaking } from "./store.js";

/** 只允许暂停并解释的四类原因，不允许删除启动依据。 */
export const PAUSE_CATEGORIES = [
  "ethics_restriction",
  "sample_shortage",
  "resource_conflict",
  "model_version_change",
];

const PAUSABLE_STATUSES = ["claimed", "preregistered", "in_progress"];

/**
 * 认领：具备相应样本与技术能力的实验室独立认领，互不阻塞，
 * 因此多个实验室可以并发认领同一主张。
 */
export function claimHypothesis(store, { hypothesisId, labId } = {}) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  const lab = mustLab(store, labId);
  assertCapabilities(lab, hypothesis.requiredCapabilities);
  const duplicate = [...store.undertakings.values()].some(
    (u) => u.hypothesisId === hypothesisId && u.labId === labId,
  );
  if (duplicate) fail("duplicate_claim", `实验室「${lab.name}」已认领该主张`);

  const undertaking = {
    id: store.nextId("und"),
    hypothesisId,
    labId,
    status: "claimed",
    pausedFrom: null,
    pauseReason: null,
    pauseHistory: [],
    preregistration: { current: null, history: [] },
    claimedAt: store.now(),
  };
  store.undertakings.set(undertaking.id, undertaking);
  store.emit("undertaking.claimed", { undertakingId: undertaking.id, hypothesisId, labId });
  return undertaking;
}

/** 实验开始前冻结关键步骤与主要终点（预注册 v1）。 */
export function freezePreregistration(store, { undertakingId, keySteps, primaryEndpoints } = {}) {
  const undertaking = mustUndertaking(store, undertakingId);
  if (undertaking.status !== "claimed") {
    fail("invalid_state", "只有尚未冻结的认领任务可以冻结预注册");
  }
  const version = {
    version: 1,
    keySteps: requireList(keySteps, "关键步骤"),
    primaryEndpoints: requireList(primaryEndpoints, "主要终点"),
    revisionReason: null,
    frozenAt: store.now(),
  };
  undertaking.preregistration.current = version;
  undertaking.preregistration.history.push(version);
  undertaking.status = "preregistered";
  store.emit("preregistration.frozen", {
    undertakingId: undertaking.id,
    hypothesisId: undertaking.hypothesisId,
    version: 1,
  });
  return version;
}

/** 预注册修订：必须说明理由，旧版本全部保留，形成可追溯的版本关系。 */
export function revisePreregistration(
  store,
  { undertakingId, keySteps, primaryEndpoints, reason } = {},
) {
  const undertaking = mustUndertaking(store, undertakingId);
  if (undertaking.status !== "preregistered" && undertaking.status !== "in_progress") {
    fail("invalid_state", "只有已冻结且未提交的任务可以修订预注册");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    fail("validation_failed", "修订预注册必须说明理由");
  }
  const version = {
    version: undertaking.preregistration.history.length + 1,
    keySteps: requireList(keySteps, "关键步骤"),
    primaryEndpoints: requireList(primaryEndpoints, "主要终点"),
    revisionReason: reason.trim(),
    frozenAt: store.now(),
  };
  undertaking.preregistration.current = version;
  undertaking.preregistration.history.push(version);
  store.emit("preregistration.revised", {
    undertakingId: undertaking.id,
    hypothesisId: undertaking.hypothesisId,
    version: version.version,
    reason: version.revisionReason,
  });
  return version;
}

export function beginExperiment(store, { undertakingId } = {}) {
  const undertaking = mustUndertaking(store, undertakingId);
  if (undertaking.status !== "preregistered") {
    fail("invalid_state", "实验开始前必须冻结关键步骤与主要终点");
  }
  undertaking.status = "in_progress";
  store.emit("undertaking.started", {
    undertakingId: undertaking.id,
    hypothesisId: undertaking.hypothesisId,
  });
  return undertaking;
}

/**
 * 暂停：伦理限制、样本不足、资源冲突、模型换版只允许暂停并解释。
 * 主张、认领记录与预注册历史全部保留，启动依据不被删除。
 */
export function pauseUndertaking(store, { undertakingId, category, explanation } = {}) {
  const undertaking = mustUndertaking(store, undertakingId);
  if (!PAUSE_CATEGORIES.includes(category)) {
    fail("validation_failed", `暂停原因必须是以下之一: ${PAUSE_CATEGORIES.join("、")}`);
  }
  if (typeof explanation !== "string" || explanation.trim() === "") {
    fail("validation_failed", "暂停必须给出解释，启动依据随之保留");
  }
  if (!PAUSABLE_STATUSES.includes(undertaking.status)) {
    fail("invalid_state", "当前状态不能暂停");
  }
  const record = { category, explanation: explanation.trim(), at: store.now() };
  undertaking.pausedFrom = undertaking.status;
  undertaking.status = "paused";
  undertaking.pauseReason = record;
  undertaking.pauseHistory.push(record);
  store.emit("undertaking.paused", {
    undertakingId: undertaking.id,
    hypothesisId: undertaking.hypothesisId,
    category,
    explanation: record.explanation,
  });
  return undertaking;
}

export function resumeUndertaking(store, { undertakingId, note } = {}) {
  const undertaking = mustUndertaking(store, undertakingId);
  if (undertaking.status !== "paused") {
    fail("invalid_state", "只有暂停中的任务可以恢复");
  }
  undertaking.status = undertaking.pausedFrom;
  undertaking.pausedFrom = null;
  store.emit("undertaking.resumed", {
    undertakingId: undertaking.id,
    hypothesisId: undertaking.hypothesisId,
    note: note ?? null,
  });
  return undertaking;
}

function requireList(value, label) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    fail("validation_failed", `${label}必须是非空字符串列表`);
  }
  return value.map((item) => item.trim());
}
