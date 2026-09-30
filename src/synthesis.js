import { fail } from "./errors.js";
import { mustHypothesis, submissionsOf, undertakingsOf } from "./store.js";

/**
 * 综合判断：解盲后计算，支持、反驳、未完成三栏始终同时呈现。
 * 结论相反（既有支持又有反驳）时判定为 contested，不掩盖分歧。
 */
export function computeSynthesis(store, hypothesisId) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  if (hypothesis.blinded) fail("invalid_state", "解盲后才能形成综合判断");
  const submissions = submissionsOf(store, hypothesisId);
  const byConclusion = (conclusion) =>
    submissions
      .filter((s) => s.conclusion === conclusion)
      .map((s) => ({
        submissionId: s.id,
        undertakingId: s.undertakingId,
        labId: s.labId,
        rawHash: s.rawHash,
        submittedAt: s.submittedAt,
      }));

  const supporting = byConclusion("supports");
  const refuting = byConclusion("refutes");
  const incomplete = [
    ...submissions
      .filter((s) => s.conclusion === "inconclusive")
      .map((s) => ({
        type: "inconclusive_submission",
        submissionId: s.id,
        undertakingId: s.undertakingId,
        labId: s.labId,
        notes: s.summary.notes,
      })),
    ...undertakingsOf(store, hypothesisId)
      .filter((u) => u.status === "paused")
      .map((u) => ({
        type: "paused_undertaking",
        undertakingId: u.id,
        labId: u.labId,
        reason: u.pauseReason,
      })),
  ];

  let verdict = "unresolved";
  if (supporting.length > 0 && refuting.length > 0) verdict = "contested";
  else if (supporting.length > 0) verdict = "supported";
  else if (refuting.length > 0) verdict = "refuted";

  return { hypothesisId, supporting, refuting, incomplete, verdict, generatedAt: store.now() };
}

/** 尚未解决的反例：可见提交中没有任何测量指向的反例条件。 */
export function unresolvedCounterexamples(store, hypothesisId, visibleSubmissionList) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  const addressed = new Set();
  for (const submission of visibleSubmissionList) {
    for (const measurement of submission.summary.measurements) {
      addressed.add(measurement.subject);
    }
  }
  return hypothesis.counterexamples.filter((cx) => !addressed.has(cx.id));
}

/**
 * 贡献台账：每一份提交都计入，无论结论是支持、反驳（负结果）
 * 还是 inconclusive（含失败复现）；认领本身也计入。
 */
export function contributionLedger(store) {
  const ledger = new Map();
  const entry = (labId) => {
    if (!ledger.has(labId)) {
      ledger.set(labId, {
        labId,
        undertakings: 0,
        submissions: 0,
        supports: 0,
        refutes: 0,
        inconclusive: 0,
      });
    }
    return ledger.get(labId);
  };
  for (const undertaking of store.undertakings.values()) {
    entry(undertaking.labId).undertakings += 1;
  }
  for (const submission of store.submissions.values()) {
    const e = entry(submission.labId);
    e.submissions += 1;
    e[submission.conclusion] += 1;
  }
  return [...ledger.values()];
}
