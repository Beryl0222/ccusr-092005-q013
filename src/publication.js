import { fail } from "./errors.js";
import { mustHypothesis } from "./store.js";

function publicationRecord(store, hypothesisId) {
  if (!store.publications.has(hypothesisId)) {
    store.publications.set(hypothesisId, {
      hypothesisId,
      dataUseApproval: null,
      attributionApproval: null,
      publishedAt: null,
    });
  }
  return store.publications.get(hypothesisId);
}

export function approveDataUse(store, { hypothesisId, approver, scope } = {}) {
  mustHypothesis(store, hypothesisId);
  if (!approver || !scope) fail("validation_failed", "数据授权需要审批人与授权范围");
  const record = publicationRecord(store, hypothesisId);
  record.dataUseApproval = { approver, scope, at: store.now() };
  store.emit("publication.data_use_approved", { hypothesisId, approver });
  return record.dataUseApproval;
}

export function approveAttribution(store, { hypothesisId, approver, scope } = {}) {
  mustHypothesis(store, hypothesisId);
  if (!approver || !scope) fail("validation_failed", "署名范围需要审批人与范围说明");
  const record = publicationRecord(store, hypothesisId);
  record.attributionApproval = { approver, scope, at: store.now() };
  store.emit("publication.attribution_approved", { hypothesisId, approver });
  return record.attributionApproval;
}

/** 公开门槛：已解盲 + 数据授权通过 + 署名范围通过，三者缺一不可。 */
export function publishHypothesis(store, { hypothesisId } = {}) {
  const hypothesis = mustHypothesis(store, hypothesisId);
  if (hypothesis.blinded) fail("publication_blocked", "未解盲的主张不能公开");
  const record = publicationRecord(store, hypothesisId);
  const missing = [];
  if (!record.dataUseApproval) missing.push("数据授权");
  if (!record.attributionApproval) missing.push("署名范围");
  if (missing.length > 0) {
    fail("publication_blocked", `公开前必须先通过: ${missing.join("、")}`);
  }
  if (!record.publishedAt) {
    record.publishedAt = store.now();
    hypothesis.status = "published";
    store.emit("hypothesis.published", { hypothesisId });
  }
  return record;
}

export function publicationOf(store, hypothesisId) {
  return publicationRecord(store, hypothesisId);
}
