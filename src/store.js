import { fail } from "./errors.js";

/**
 * 内存存储：领域记录（数据集/分析运行）、主张、实验室、验证任务、
 * 测量提交、公开记录，以及只增不删的审计日志。
 * 审计日志是“启动依据不可删除”的载体——只提供追加，没有移除接口。
 */
export class Store {
  constructor({ records = [], now } = {}) {
    this.now = now ?? (() => new Date().toISOString());
    this.records = new Map(records.map((record) => [record.id, record]));
    this.hypotheses = new Map();
    this.labs = new Map();
    this.undertakings = new Map();
    this.submissions = new Map();
    this.publications = new Map();
    this.audit = [];
    this.counters = new Map();
  }

  nextId(prefix) {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}-${next}`;
  }

  emit(type, payload = {}) {
    this.audit.push({ type, at: this.now(), ...payload });
  }
}

export function mustHypothesis(store, id) {
  const hypothesis = store.hypotheses.get(id);
  if (!hypothesis) fail("unknown_hypothesis", `主张不存在: ${id}`);
  return hypothesis;
}

export function mustLab(store, id) {
  const lab = store.labs.get(id);
  if (!lab) fail("unknown_lab", `实验室不存在: ${id}`);
  return lab;
}

export function mustUndertaking(store, id) {
  const undertaking = store.undertakings.get(id);
  if (!undertaking) fail("unknown_undertaking", `验证任务不存在: ${id}`);
  return undertaking;
}

export function undertakingsOf(store, hypothesisId) {
  return [...store.undertakings.values()].filter((u) => u.hypothesisId === hypothesisId);
}

export function submissionsOf(store, hypothesisId) {
  return [...store.submissions.values()].filter((s) => s.hypothesisId === hypothesisId);
}
