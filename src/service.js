import { proposeHypothesis } from "./hypotheses.js";
import { registerLab } from "./labs.js";
import {
  approveAttribution,
  approveDataUse,
  publicationOf,
  publishHypothesis,
} from "./publication.js";
import { Store, mustHypothesis, undertakingsOf } from "./store.js";
import { submitMeasurements, unblindHypothesis, visibleSubmissions } from "./submissions.js";
import {
  computeSynthesis,
  contributionLedger,
  unresolvedCounterexamples,
} from "./synthesis.js";
import {
  beginExperiment,
  claimHypothesis,
  freezePreregistration,
  pauseUndertaking,
  resumeUndertaking,
  revisePreregistration,
} from "./undertakings.js";

const clone = (value) => (value === undefined ? value : structuredClone(value));

/**
 * 假设验证协作后端门面。
 * 所有返回值都是深拷贝，外部无法绕过状态机直接改内部状态。
 */
export class CollaborationService {
  /** records：领域资料（数据集与分析运行），可直接传入 loadSeed() 的结果。 */
  constructor({ records = [], now } = {}) {
    this.store = new Store({ records, now });
  }

  // ---- 主张 ----
  proposeHypothesis(input) {
    return clone(proposeHypothesis(this.store, input));
  }

  getHypothesis(id) {
    return clone(mustHypothesis(this.store, id));
  }

  listHypotheses() {
    return clone([...this.store.hypotheses.values()]);
  }

  // ---- 实验室 ----
  registerLab(input) {
    return clone(registerLab(this.store, input));
  }

  listLabs() {
    return clone([...this.store.labs.values()]);
  }

  // ---- 认领与预注册 ----
  claimHypothesis(input) {
    return clone(claimHypothesis(this.store, input));
  }

  freezePreregistration(input) {
    return clone(freezePreregistration(this.store, input));
  }

  revisePreregistration(input) {
    return clone(revisePreregistration(this.store, input));
  }

  beginExperiment(input) {
    return clone(beginExperiment(this.store, input));
  }

  pauseUndertaking(input) {
    return clone(pauseUndertaking(this.store, input));
  }

  resumeUndertaking(input) {
    return clone(resumeUndertaking(this.store, input));
  }

  // ---- 盲态提交与解盲 ----
  submitMeasurements(input) {
    return clone(submitMeasurements(this.store, input));
  }

  unblindHypothesis(input) {
    return clone(unblindHypothesis(this.store, input));
  }

  listSubmissions(hypothesisId, options = {}) {
    return clone(visibleSubmissions(this.store, hypothesisId, options));
  }

  // ---- 综合判断与贡献 ----
  getSynthesis(hypothesisId) {
    return clone(computeSynthesis(this.store, hypothesisId));
  }

  contributionLedger() {
    return clone(contributionLedger(this.store));
  }

  // ---- 公开 ----
  approveDataUse(input) {
    return clone(approveDataUse(this.store, input));
  }

  approveAttribution(input) {
    return clone(approveAttribution(this.store, input));
  }

  publishHypothesis(input) {
    return clone(publishHypothesis(this.store, input));
  }

  auditLog() {
    return clone(this.store.audit);
  }

  /**
   * 读者卷宗：从任一主张查到验证方案、执行团队、版本关系、
   * 尚未解决的反例、（解盲后的）综合判断与公开状态。
   * 盲态阶段传 requestingLabId 只能看到本实验室的提交。
   */
  getClaimDossier(hypothesisId, { requestingLabId } = {}) {
    const hypothesis = mustHypothesis(this.store, hypothesisId);
    const undertakings = undertakingsOf(this.store, hypothesisId);
    const submissions = visibleSubmissions(this.store, hypothesisId, { requestingLabId });
    return clone({
      hypothesis,
      source: hypothesis.source,
      verificationPlans: undertakings.map((u) => ({
        undertakingId: u.id,
        lab: labView(this.store, u.labId),
        status: u.status,
        currentPlan: u.preregistration.current,
        planHistory: u.preregistration.history,
        pause: u.pauseReason,
      })),
      teams: [...new Map(undertakings.map((u) => [u.labId, labView(this.store, u.labId)])).values()],
      submissions,
      synthesis: hypothesis.blinded ? null : computeSynthesis(this.store, hypothesisId),
      unresolvedCounterexamples: unresolvedCounterexamples(this.store, hypothesisId, submissions),
      publication: publicationOf(this.store, hypothesisId),
      auditTrail: this.store.audit.filter((event) => event.hypothesisId === hypothesisId),
    });
  }
}

function labView(store, labId) {
  const lab = store.labs.get(labId);
  return lab ? { id: lab.id, name: lab.name } : { id: labId, name: null };
}
