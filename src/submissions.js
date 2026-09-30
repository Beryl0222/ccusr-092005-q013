import { fail } from "./errors.js";
import { mustHypothesis, mustUndertaking, submissionsOf, undertakingsOf } from "./store.js";

const CONCLUSIONS = ["supports", "refutes", "inconclusive"];
const HASH_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/;

/**
 * 盲态提交：测量摘要 + 原始材料哈希。
 * 只有进行中的实验可以提交；解盲后该主张停止接收提交，
 * 保证“互不可见阶段”之后不会出现事后补交。
 */
export function submitMeasurements(store, { undertakingId, summary, conclusion, rawHash } = {}) {
  const undertaking = mustUndertaking(store, undertakingId);
  const hypothesis = mustHypothesis(store, undertaking.hypothesisId);
  if (!hypothesis.blinded) {
    fail("invalid_state", "该主张已解盲，不能继续提交测量");
  }
  if (undertaking.status !== "in_progress") {
    fail("invalid_state", "只有进行中的实验可以提交测量摘要");
  }
  if (!CONCLUSIONS.includes(conclusion)) {
    fail("validation_failed", `结论必须是: ${CONCLUSIONS.join("、")}`);
  }
  if (typeof rawHash !== "string" || !HASH_PATTERN.test(rawHash)) {
    fail("invalid_hash", "原始材料哈希必须是 64 位十六进制（可带 sha256: 前缀）");
  }
  const submission = {
    id: store.nextId("sub"),
    undertakingId: undertaking.id,
    hypothesisId: hypothesis.id,
    labId: undertaking.labId,
    summary: normalizeSummary(hypothesis, summary),
    conclusion,
    rawHash: rawHash.startsWith("sha256:") ? rawHash : `sha256:${rawHash}`,
    submittedAt: store.now(),
  };
  store.submissions.set(submission.id, submission);
  undertaking.status = "submitted";
  store.emit("submission.received", {
    submissionId: submission.id,
    undertakingId: undertaking.id,
    hypothesisId: hypothesis.id,
    labId: undertaking.labId,
    conclusion,
  });
  return submission;
}

/**
 * 解盲：所有未暂停的验证任务都已提交，且至少有一份测量。
 * 暂停中的任务不阻塞解盲，其缺口在综合判断中记为未完成证据。
 */
export function unblindHypothesis(store, { hypothesisId } = {}) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  if (!hypothesis.blinded) fail("invalid_state", "该主张已经解盲");
  const undertakings = undertakingsOf(store, hypothesisId);
  if (undertakings.length === 0) fail("invalid_state", "没有验证任务，不能解盲");
  const pending = undertakings.filter((u) => u.status !== "submitted" && u.status !== "paused");
  if (pending.length > 0) {
    fail(
      "invalid_state",
      `仍有未提交且未暂停的验证任务: ${pending.map((u) => u.id).join("、")}`,
    );
  }
  if (!undertakings.some((u) => u.status === "submitted")) {
    fail("invalid_state", "没有任何测量提交，不能解盲");
  }
  hypothesis.blinded = false;
  hypothesis.status = "unblinded";
  hypothesis.unblindedAt = store.now();
  store.emit("hypothesis.unblinded", { hypothesisId });
  return hypothesis;
}

/** 互不可见阶段：实验室只能看到自己的提交；解盲后全部可见。 */
export function visibleSubmissions(store, hypothesisId, { requestingLabId } = {}) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  const all = submissionsOf(store, hypothesisId);
  if (!hypothesis.blinded) return all;
  return all.filter((s) => s.labId === requestingLabId);
}

function normalizeSummary(hypothesis, summary) {
  if (!summary || !Array.isArray(summary.measurements) || summary.measurements.length === 0) {
    fail("validation_failed", "测量摘要必须包含至少一条测量");
  }
  const subjects = new Set([
    ...hypothesis.predictions.map((p) => p.id),
    ...hypothesis.counterexamples.map((c) => c.id),
  ]);
  const measurements = summary.measurements.map((measurement, index) => {
    if (!subjects.has(measurement?.subject)) {
      fail(
        "validation_failed",
        `测量 ${index + 1} 指向了未知的预测或反例标识: ${measurement?.subject}`,
      );
    }
    if (typeof measurement.observed !== "string" || measurement.observed.trim() === "") {
      fail("validation_failed", `测量 ${index + 1} 缺少观测结果`);
    }
    return { subject: measurement.subject, observed: measurement.observed.trim() };
  });
  return { measurements, notes: typeof summary.notes === "string" ? summary.notes : "" };
}
