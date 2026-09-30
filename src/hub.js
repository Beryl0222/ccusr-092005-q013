import { createHash, randomUUID } from "node:crypto";

import { DomainError } from "./errors.js";
import { MemoryEventStore } from "./store.js";

const PAUSE_REASONS = new Set(["ethics", "sample_shortage", "resource_conflict", "model_version_change"]);
const PAUSE_LABEL = {
  ethics: "伦理限制",
  sample_shortage: "样本不足",
  resource_conflict: "资源冲突",
  model_version_change: "模型换版",
};

const nowIso = () => new Date().toISOString();

function applyEvent(state, event) {
  const s = state ?? {
    exists: false,
    version: 0,
    claims: [],
    slots: new Map(),
    submissions: new Map(),
    counterexamples: [],
    dataApprovals: new Map(),
    authorshipApprovals: new Map(),
    status: "draft",
    publicationStatus: "private",
    amendments: 0,
    history: [],
  };

  const e = { type: event.type, at: event.at, by: event.actor };
  switch (event.type) {
    case "HypothesisProposed":
      return {
        ...s,
        exists: true,
        id: event.aggregateId,
        title: event.payload.title,
        cellSet: event.payload.cellSet,
        predictions: event.payload.predictions,
        falsifiers: event.payload.falsifiers,
        source: event.payload.source,
        proposedBy: event.actor,
        status: "open",
        claims: [],
        history: [...s.history, e],
      };

    case "ClaimMade": {
      const p = event.payload;
      const slot = {
        labId: p.labId,
        claimedAt: event.at,
        claimVersion: p.version,
        preregistration: null,
        frozen: false,
        frozenAt: null,
        executionStatus: "claimed",
        execution: [],
        pauseCount: 0,
        submission: null,
        unsealed: false,
      };
      s.slots.set(p.labId, slot);
      s.claims.push({ labId: p.labId, claimedAt: event.at });
      s.history.push(e);
      return s;
    }

    case "PreregistrationSubmitted": {
      const slot = s.slots.get(event.payload.labId);
      slot.preregistration = {
        keySteps: event.payload.keySteps,
        primaryEndpoints: event.payload.primaryEndpoints,
        samplePlan: event.payload.samplePlan ?? null,
        techniques: event.payload.techniques ?? [],
        submittedAt: event.at,
        revisions: [],
      };
      slot.executionStatus = "preregistered";
      s.history.push(e);
      return s;
    }

    case "PreregistrationRevised": {
      const slot = s.slots.get(event.payload.labId);
      // 每次修订的完整内容留痕；当前方案更新为修订后的版本（冻结后此分支不可达）
      slot.preregistration.revisions.push({
        keySteps: event.payload.keySteps,
        primaryEndpoints: event.payload.primaryEndpoints,
        samplePlan: event.payload.samplePlan,
        techniques: event.payload.techniques,
        rationale: event.payload.rationale,
        at: event.at,
      });
      slot.preregistration.keySteps = event.payload.keySteps;
      slot.preregistration.primaryEndpoints = event.payload.primaryEndpoints;
      slot.preregistration.samplePlan = event.payload.samplePlan;
      slot.preregistration.techniques = event.payload.techniques;
      s.amendments += 1;
      s.history.push(e);
      return s;
    }

    case "ProtocolFrozen": {
      const slot = s.slots.get(event.payload.labId);
      slot.frozen = true;
      slot.frozenAt = event.at;
      slot.executionStatus = "frozen";
      s.history.push(e);
      return s;
    }

    case "ExperimentPaused": {
      const slot = s.slots.get(event.payload.labId);
      slot.executionStatus = "paused";
      slot.pauseCount += 1;
      slot.execution.push({
        kind: "pause",
        reason: event.payload.reason,
        explanation: event.payload.explanation,
        at: event.at,
      });
      s.history.push(e);
      return s;
    }

    case "ExperimentResumed": {
      const slot = s.slots.get(event.payload.labId);
      slot.executionStatus = "running";
      slot.execution.push({ kind: "resume", explanation: event.payload.explanation, at: event.at });
      s.history.push(e);
      return s;
    }

    case "ExperimentFailed": {
      const slot = s.slots.get(event.payload.labId);
      slot.executionStatus = "failed";
      slot.execution.push({
        kind: "failure",
        reason: event.payload.reason,
        explanation: event.payload.explanation,
        at: event.at,
      });
      s.history.push(e);
      return s;
    }

    case "MeasurementSubmittedBlind": {
      const slot = s.slots.get(event.payload.labId);
      slot.submission = {
        summary: event.payload.summary,
        rawDataHash: event.payload.rawDataHash,
        conclusionDirection: event.payload.conclusionDirection,
        submittedAt: event.at,
      };
      slot.executionStatus = "submitted";
      s.submissions.set(event.payload.labId, slot.submission);
      s.history.push(e);
      return s;
    }

    case "SubmissionUnsealed": {
      const slot = s.slots.get(event.payload.labId);
      slot.unsealed = true;
      s.history.push(e);
      return s;
    }

    case "CounterexampleRaised": {
      s.counterexamples.push({
        id: event.payload.counterexampleId,
        labId: event.payload.labId,
        description: event.payload.description,
        evidence: event.payload.evidence ?? null,
        raisedAt: event.at,
        status: "open",
      });
      s.history.push(e);
      return s;
    }

    case "CounterexampleResolved": {
      const ce = s.counterexamples.find((c) => c.id === event.payload.counterexampleId);
      ce.status = "resolved";
      ce.resolution = event.payload.resolution;
      ce.resolvedAt = event.at;
      s.history.push(e);
      return s;
    }

    case "DataAuthorizationGranted":
      s.dataApprovals.set(event.payload.labId, { granted: true, scope: event.payload.scope, at: event.at });
      s.history.push(e);
      return s;

    case "DataAuthorizationRevoked":
      s.dataApprovals.delete(event.payload.labId);
      s.history.push(e);
      return s;

    case "AuthorshipApproved":
      s.authorshipApprovals.set(event.payload.labId, { scope: event.payload.scope, at: event.at });
      s.history.push(e);
      return s;

    case "AuthorshipRevoked":
      s.authorshipApprovals.delete(event.payload.labId);
      s.history.push(e);
      return s;

    case "HypothesisPublished":
      s.publicationStatus = "published";
      s.publishedAt = event.at;
      s.history.push(e);
      return s;

    default:
      return s;
  }
}

function replay(events) {
  return events.reduce((state, event) => applyEvent(state, event), null);
}

/**
 * 假设验证协作中枢。
 * 全部状态由只追加事件推导：暂停、撤销授权、失败复现都只能追加事件，
 * 认领记录、冻结前方案与启动依据不会被删除或改写。
 */
export class Hub {
  constructor({ catalog, store = new MemoryEventStore(), clock = nowIso } = {}) {
    if (!catalog) throw new Error("Hub 需要 catalog（现有数据集与分析运行目录）");
    this.catalog = catalog;
    this.store = store;
    this.clock = clock;
  }

  #emit(aggregateId, type, payload, actor, expectedVersion) {
    const event = { eventId: randomUUID(), aggregateId, type, payload, actor, at: this.clock() };
    return this.store.append(event, expectedVersion);
  }

  #load(hypothesisId) {
    const events = this.store.forAggregate(hypothesisId);
    const state = replay(events);
    if (!state?.exists) {
      throw new DomainError("UNKNOWN_HYPOTHESIS", `不存在的假设 ${hypothesisId}`, { hypothesisId });
    }
    return { state, version: this.store.versionOf(hypothesisId) };
  }

  #slot(state, labId) {
    const slot = state.slots.get(labId);
    if (!slot) {
      throw new DomainError("LAB_NOT_CLAIMED", `实验室 ${labId} 未认领该假设`, { labId });
    }
    return slot;
  }

  #validateHash(rawDataHash) {
    if (typeof rawDataHash !== "string" || !/^[a-z0-9]+:[a-f0-9]{16,}$/i.test(rawDataHash)) {
      throw new DomainError(
        "INVALID_HASH",
        "原始材料哈希格式应为 algo:hex（如 sha256:abcd…）",
        { rawDataHash },
      );
    }
  }

  /**
   * 从一次现有分析运行（如 UCE 运行）的某个发现提出可被反驳的假设：
   * 必须给出适用细胞集合、预测现象与至少一条反例条件。
   */
  proposeHypothesis({ findingId, runId, title, cellSet, predictions, falsifiers, actor, id }) {
    const finding = this.catalog.getFinding(findingId);
    const run = this.catalog.getRun(runId ?? finding.runId);
    if (finding.runId !== run.id) {
      throw new DomainError(
        "FINDING_RUN_MISMATCH",
        `发现 ${findingId} 不属于运行 ${run.id}`,
        { findingId, runId: run.id },
      );
    }
    if (run.state !== "completed") {
      throw new DomainError("RUN_NOT_COMPLETED", `运行 ${run.id} 尚未完成，不能作为假设来源`, { runId: run.id });
    }
    if (!Array.isArray(cellSet) || cellSet.length === 0) {
      throw new DomainError("EMPTY_CELL_SET", "适用细胞集合不能为空");
    }
    for (const datasetId of cellSet) {
      this.catalog.getDataset(datasetId);
      if (!run.datasets.includes(datasetId)) {
        throw new DomainError(
          "CELL_SET_OUTSIDE_RUN",
          `细胞集合 ${datasetId} 不在来源运行 ${run.id} 的输入范围内`,
          { datasetId, runId: run.id },
        );
      }
    }
    if (!Array.isArray(predictions) || predictions.length === 0) {
      throw new DomainError("EMPTY_PREDICTIONS", "预测现象不能为空");
    }
    if (!Array.isArray(falsifiers) || falsifiers.length === 0) {
      throw new DomainError("EMPTY_FALSIFIERS", "假设至少需要一条反例条件，否则不可被反驳");
    }

    const hypothesisId = id ?? `hyp-${findingId}-${randomUUID().slice(0, 8)}`;
    if (this.store.versionOf(hypothesisId) !== 0) {
      throw new DomainError("HYPOTHESIS_EXISTS", `假设标识已存在 ${hypothesisId}`, { hypothesisId });
    }

    this.#emit(
      hypothesisId,
      "HypothesisProposed",
      {
        title,
        cellSet,
        predictions,
        falsifiers,
        source: {
          runId: run.id,
          findingId,
          model: run.model,
          modelVersion: run.model_version ?? null,
          findingLabel: finding.label,
        },
      },
      actor,
      0,
    );
    return this.getHypothesis(hypothesisId);
  }

  /** 具备相应样本与技术能力的实验室独立认领；同一允许多个实验室并发认领。 */
  claim(hypothesisId, { labId, sampleCapability, technicalCapability, actor }) {
    const { state, version } = this.#load(hypothesisId);
    if (!labId) throw new DomainError("BAD_INPUT", "缺少实验室标识");
    if (state.slots.has(labId)) {
      throw new DomainError("ALREADY_CLAIMED", `实验室 ${labId} 已认领该假设`, { labId });
    }
    if (!sampleCapability || !technicalCapability) {
      throw new DomainError("CAPABILITY_UNDECLARED", "认领时必须声明样本与技术能力", { labId });
    }
    this.#emit(
      hypothesisId,
      "ClaimMade",
      { labId, version: `${state.source.modelVersion}@${state.source.runId}`, sampleCapability, technicalCapability },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  /** 实验开始前提交预注册：关键步骤与主要终点。 */
  submitPreregistration(hypothesisId, { labId, keySteps, primaryEndpoints, samplePlan, techniques, actor }) {
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (!Array.isArray(keySteps) || keySteps.length === 0) {
      throw new DomainError("EMPTY_KEY_STEPS", "预注册必须包含关键步骤");
    }
    if (!Array.isArray(primaryEndpoints) || primaryEndpoints.length === 0) {
      throw new DomainError("EMPTY_ENDPOINTS", "预注册必须包含主要终点");
    }
    this.#emit(
      hypothesisId,
      "PreregistrationSubmitted",
      { labId, keySteps, primaryEndpoints, samplePlan: samplePlan ?? null, techniques: techniques ?? [] },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  /**
   * 冻结前允许修订预注册，但每次修订连同理由永久保留；
   * 冻结之后关键步骤与主要终点不可再改（模型换版等只能暂停并解释）。
   */
  revisePreregistration(hypothesisId, { labId, keySteps, primaryEndpoints, rationale, samplePlan, techniques, actor }) {
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (!slot.preregistration) {
      throw new DomainError("NO_PREREGISTRATION", "尚未提交预注册，无从修订");
    }
    if (slot.frozen) {
      throw new DomainError(
        "PROTOCOL_FROZEN",
        "关键步骤与主要终点已冻结；如遇模型换版等情形只能暂停实验并说明，不能改写方案",
        { labId, frozenAt: slot.frozenAt },
      );
    }
    if (!rationale || !String(rationale).trim()) {
      throw new DomainError("REVISION_WITHOUT_RATIONALE", "预注册修订必须给出理由");
    }
    this.#emit(
      hypothesisId,
      "PreregistrationRevised",
      {
        labId,
        keySteps: keySteps ?? slot.preregistration.keySteps,
        primaryEndpoints: primaryEndpoints ?? slot.preregistration.primaryEndpoints,
        samplePlan: samplePlan ?? slot.preregistration.samplePlan,
        techniques: techniques ?? slot.preregistration.techniques,
        rationale,
      },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  /** 实验开始前冻结关键步骤与主要终点；冻结后才允许进入执行。 */
  freezeProtocol(hypothesisId, { labId, actor }) {
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (!slot.preregistration) {
      throw new DomainError("NO_PREREGISTRATION", "冻结前必须先提交预注册");
    }
    if (slot.frozen) {
      throw new DomainError("PROTOCOL_FROZEN", "方案已经冻结", { labId });
    }
    this.#emit(hypothesisId, "ProtocolFrozen", { labId }, actor ?? labId, version);
    return this.getHypothesis(hypothesisId);
  }

  /**
   * 暂停实验：伦理限制、样本不足、资源冲突或模型换版。
   * 暂停只追加解释，不删除认领与预注册；必须说明原因，恢复后方可继续。
   */
  pauseExperiment(hypothesisId, { labId, reason, explanation, actor }) {
    if (!PAUSE_REASONS.has(reason)) {
      throw new DomainError(
        "BAD_PAUSE_REASON",
        `暂停原因必须是以下之一：${[...PAUSE_REASONS].join("、")}`,
        { reason },
      );
    }
    if (!explanation || !String(explanation).trim()) {
      throw new DomainError("PAUSE_WITHOUT_EXPLANATION", "暂停必须附说明；启动依据不会被删除");
    }
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (!slot.frozen) throw new DomainError("NOT_FROZEN", "实验尚未冻结启动，不能暂停");
    if (slot.executionStatus === "failed") {
      throw new DomainError("SLOT_FAILED", "该认领已记为失败终止，需重新认领");
    }
    if (slot.submission) throw new DomainError("ALREADY_SUBMITTED", "已提交测量，不能暂停");
    this.#emit(
      hypothesisId,
      "ExperimentPaused",
      { labId, reason, explanation, reasonLabel: PAUSE_LABEL[reason] },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  resumeExperiment(hypothesisId, { labId, explanation, actor }) {
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (slot.executionStatus !== "paused") {
      throw new DomainError("NOT_PAUSED", "实验当前不处于暂停状态");
    }
    this.#emit(hypothesisId, "ExperimentResumed", { labId, explanation: explanation ?? null }, actor ?? labId, version);
    return this.getHypothesis(hypothesisId);
  }

  /** 无法完成的复现（样本/资源/技术原因）也要如实记录，不能被静默删除。 */
  failExperiment(hypothesisId, { labId, reason, explanation, actor }) {
    if (!explanation || !String(explanation).trim()) {
      throw new DomainError("FAILURE_WITHOUT_EXPLANATION", "终止失败必须附说明");
    }
    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (slot.submission) throw new DomainError("ALREADY_SUBMITTED", "已提交测量，不能记为执行失败");
    this.#emit(
      hypothesisId,
      "ExperimentFailed",
      { labId, reason: reason ?? "unspecified", explanation },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  /**
   * 互不可见阶段提交：测量摘要 + 原始材料哈希。
   * 此时其他实验室只能看到“已提交”状态，看不到摘要、方向与哈希。
   */
  submitBlind(hypothesisId, { labId, summary, rawDataHash, conclusionDirection, actor }) {
    const validDirections = new Set(["supports", "refutes", "inconclusive"]);
    if (!validDirections.has(conclusionDirection)) {
      throw new DomainError("BAD_DIRECTION", "结论方向必须是 supports / refutes / inconclusive");
    }
    if (!summary || typeof summary !== "object") {
      throw new DomainError("EMPTY_SUMMARY", "测量摘要必须是结构化内容");
    }
    this.#validateHash(rawDataHash);

    const { state, version } = this.#load(hypothesisId);
    const slot = this.#slot(state, labId);
    if (!slot.frozen) {
      throw new DomainError("NOT_FROZEN", "实验开始前必须冻结关键步骤与主要终点");
    }
    if (slot.executionStatus === "paused") {
      throw new DomainError("PAUSED", "实验处于暂停状态，恢复后才能提交");
    }
    if (slot.submission) {
      throw new DomainError("ALREADY_SUBMITTED", "该实验室已提交，盲态阶段不允许修改或替换");
    }
    this.#emit(
      hypothesisId,
      "MeasurementSubmittedBlind",
      { labId, summary, rawDataHash, conclusionDirection },
      actor ?? labId,
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  /**
   * 解盲：所有已提交材料对所有实验室公开。可按已提交实验室集合校验，
   * 未提交（暂停中/失败）的实验室保留为未完成证据。
   */
  unseal(hypothesisId, { expectedLabIds, actor } = {}) {
    const { state, version } = this.#load(hypothesisId);
    const submitted = [...state.submissions.keys()];
    if (submitted.length === 0) {
      throw new DomainError("NO_SUBMISSIONS", "尚无任何盲态提交，不能解盲");
    }
    if (expectedLabIds) {
      const missing = expectedLabIds.filter((labId) => !submitted.includes(labId));
      if (missing.length) {
        throw new DomainError("NOT_ALL_SUBMITTED", "指定实验室尚未全部提交", { missing });
      }
    }
    for (const labId of submitted) {
      this.store.append(
        {
          eventId: randomUUID(),
          aggregateId: hypothesisId,
          type: "SubmissionUnsealed",
          payload: { labId },
          actor: actor ?? "coordinator",
          at: this.clock(),
        },
        this.store.versionOf(hypothesisId),
      );
    }
    return this.getHypothesis(hypothesisId);
  }

  /** 解盲后允许登记反例（可以来自得出相反结论的实验室）。 */
  raiseCounterexample(hypothesisId, { labId, description, evidence, actor }) {
    if (!description || !String(description).trim()) {
      throw new DomainError("EMPTY_COUNTEREXAMPLE", "反例必须有描述");
    }
    const { state, version } = this.#load(hypothesisId);
    this.#slot(state, labId);
    const counterexampleId = `ce-${randomUUID().slice(0, 8)}`;
    this.#emit(
      hypothesisId,
      "CounterexampleRaised",
      { counterexampleId, labId, description, evidence: evidence ?? null },
      actor ?? labId,
      version,
    );
    return counterexampleId;
  }

  resolveCounterexample(hypothesisId, { counterexampleId, resolution, actor }) {
    if (!resolution || !String(resolution).trim()) {
      throw new DomainError("EMPTY_RESOLUTION", "反例处理结论不能为空");
    }
    const { state, version } = this.#load(hypothesisId);
    const ce = state.counterexamples.find((c) => c.id === counterexampleId);
    if (!ce) throw new DomainError("UNKNOWN_COUNTEREXAMPLE", "不存在的反例", { counterexampleId });
    if (ce.status === "resolved") {
      throw new DomainError("COUNTEREXAMPLE_RESOLVED", "反例已有处理结论", { counterexampleId });
    }
    this.#emit(
      hypothesisId,
      "CounterexampleResolved",
      { counterexampleId, resolution },
      actor ?? "coordinator",
      version,
    );
    return this.getHypothesis(hypothesisId);
  }

  grantDataAuthorization(hypothesisId, { labId, scope, actor }) {
    const { state, version } = this.#load(hypothesisId);
    this.#slot(state, labId);
    if (!scope || !String(scope).trim()) throw new DomainError("EMPTY_SCOPE", "授权范围不能为空");
    this.#emit(hypothesisId, "DataAuthorizationGranted", { labId, scope }, actor ?? "data-steward", version);
    return this.gatingStatus(hypothesisId);
  }

  revokeDataAuthorization(hypothesisId, { labId, actor }) {
    const { state, version } = this.#load(hypothesisId);
    this.#slot(state, labId);
    if (!state.dataApprovals.has(labId)) {
      throw new DomainError("NO_AUTHORIZATION", "该实验室当前没有数据授权");
    }
    this.#emit(hypothesisId, "DataAuthorizationRevoked", { labId }, actor ?? "data-steward", version);
    return this.gatingStatus(hypothesisId);
  }

  approveAuthorship(hypothesisId, { labId, scope, actor }) {
    const { state, version } = this.#load(hypothesisId);
    this.#slot(state, labId);
    if (!scope || !String(scope).trim()) throw new DomainError("EMPTY_SCOPE", "署名范围不能为空");
    this.#emit(hypothesisId, "AuthorshipApproved", { labId, scope }, actor ?? "publication-board", version);
    return this.gatingStatus(hypothesisId);
  }

  revokeAuthorship(hypothesisId, { labId, actor }) {
    const { state, version } = this.#load(hypothesisId);
    this.#slot(state, labId);
    if (!state.authorshipApprovals.has(labId)) {
      throw new DomainError("NO_AUTHORSHIP_APPROVAL", "该实验室当前没有署名审批");
    }
    this.#emit(hypothesisId, "AuthorshipRevoked", { labId }, actor ?? "publication-board", version);
    return this.gatingStatus(hypothesisId);
  }

  /** 数据授权与署名范围双双通过后才允许公开；任何参与方缺失其一即被闸门拦截。 */
  publish(hypothesisId, { actor } = {}) {
    const { state, version } = this.#load(hypothesisId);
    if (state.submissions.size === 0) {
      throw new DomainError("NO_EVIDENCE", "尚无任何测量提交，不能公开");
    }
    if ([...state.slots.values()].some((slot) => !slot.unsealed && slot.submission)) {
      throw new DomainError("STILL_BLIND", "已提交材料尚未全部解盲");
    }

    const participantLabs = new Set(state.claims.map((c) => c.labId));
    const missingData = [...participantLabs].filter((labId) => !state.dataApprovals.has(labId));
    const missingAuthorship = [...participantLabs].filter((labId) => !state.authorshipApprovals.has(labId));
    if (missingData.length || missingAuthorship.length) {
      throw new DomainError(
        "GATE_BLOCKED",
        "数据授权或署名范围未全部通过，禁止公开",
        { missingDataAuthorization: missingData, missingAuthorship: missingAuthorship },
      );
    }

    this.#emit(hypothesisId, "HypothesisPublished", {}, actor ?? "coordinator", version);
    return this.getHypothesis(hypothesisId);
  }

  // ---------- 投影 ----------

  getHypothesis(hypothesisId) {
    const { state, version } = this.#load(hypothesisId);
    return {
      id: hypothesisId,
      version,
      title: state.title,
      cellSet: state.cellSet,
      predictions: state.predictions,
      falsifiers: state.falsifiers,
      source: state.source,
      status: state.status,
      amendments: state.amendments,
      publicationStatus: state.publicationStatus,
      claims: state.claims.map((claim) => {
        const slot = state.slots.get(claim.labId);
        return {
          labId: claim.labId,
          claimedAt: claim.claimedAt,
          claimVersion: slot.claimVersion,
          hasPreregistration: Boolean(slot.preregistration),
          frozen: slot.frozen,
          frozenAt: slot.frozenAt,
          executionStatus: slot.executionStatus,
          pauseCount: slot.pauseCount,
          submitted: Boolean(slot.submission),
          unsealed: slot.unsealed,
        };
      }),
      history: state.history,
    };
  }

  listHypotheses() {
    const ids = new Set(this.store.all().map((event) => event.aggregateId));
    return [...ids].map((id) => this.getHypothesis(id));
  }

  /**
   * 实验室视角：盲态期间（该假设未解盲）对其他实验室的提交做脱敏，
   * 只能看到哪些实验室已提交，看不到摘要、结论方向与原始材料哈希。
   */
  viewFor(hypothesisId, viewerLabId) {
    const { state } = this.#load(hypothesisId);
    const anyUnsealed = [...state.slots.values()].some((slot) => slot.unsealed);

    const claims = state.claims.map((claim) => {
      const slot = state.slots.get(claim.labId);
      const own = claim.labId === viewerLabId;
      const visible = own || anyUnsealed;
      return {
        labId: claim.labId,
        executionStatus: slot.executionStatus,
        frozen: slot.frozen,
        pauseCount: slot.pauseCount,
        preregistration: slot.preregistration
          ? {
              keySteps: slot.preregistration.keySteps,
              primaryEndpoints: slot.preregistration.primaryEndpoints,
              samplePlan: slot.preregistration.samplePlan,
              techniques: slot.preregistration.techniques,
              submittedAt: slot.preregistration.submittedAt,
              revisions: slot.preregistration.revisions,
            }
          : null,
        submission: slot.submission && visible
          ? { ...slot.submission }
          : slot.submission
            ? { submittedAt: slot.submission.submittedAt, blinded: true }
            : null,
      };
    });

    return {
      id: hypothesisId,
      viewerLabId,
      blinded: !anyUnsealed,
      claims,
      counterexamples: anyUnsealed ? state.counterexamples : state.counterexamples.filter((c) => c.labId === viewerLabId),
    };
  }

  /**
   * 解盲后的综合判断：支持、反驳、未完成证据必须同时呈现；
   * 失败复现与负结果单列并计入贡献台账。
   */
  synthesis(hypothesisId) {
    const { state } = this.#load(hypothesisId);
    const supporting = [];
    const refuting = [];
    const inconclusive = [];
    const unfinished = [];
    const contributions = [];

    for (const claim of state.claims) {
      const slot = state.slots.get(claim.labId);
      const base = {
        labId: claim.labId,
        claimVersion: slot.claimVersion,
        frozenAt: slot.frozenAt,
        pauseCount: slot.pauseCount,
      };
      if (slot.executionStatus === "failed") {
        const failure = [...slot.execution].reverse().find((x) => x.kind === "failure");
        unfinished.push({ ...base, reason: "failed", detail: failure ?? null });
        contributions.push({ labId: claim.labId, kind: "failed_replication", detail: failure ?? null });
        continue;
      }
      if (!slot.submission) {
        unfinished.push({
          ...base,
          reason: slot.executionStatus === "paused" ? "paused" : "not_submitted",
          pauses: slot.execution.filter((x) => x.kind === "pause"),
        });
        if (slot.executionStatus === "paused") {
          contributions.push({
            labId: claim.labId,
            kind: "paused_with_explanation",
            detail: slot.execution.filter((x) => x.kind === "pause"),
          });
        }
        continue;
      }
      if (!slot.unsealed) {
        unfinished.push({ ...base, reason: "sealed" });
        continue;
      }

      const record = {
        ...base,
        summary: slot.submission.summary,
        rawDataHash: slot.submission.rawDataHash,
        submittedAt: slot.submission.submittedAt,
      };
      if (slot.submission.conclusionDirection === "supports") supporting.push(record);
      else if (slot.submission.conclusionDirection === "refutes") refuting.push(record);
      else inconclusive.push(record);

      contributions.push({
        labId: claim.labId,
        kind: slot.submission.conclusionDirection === "refutes" ? "negative_result" : "measurement",
        conclusionDirection: slot.submission.conclusionDirection,
      });
    }

    return {
      hypothesisId,
      evidence: { supporting, refuting, inconclusive, unfinished },
      counterexamples: {
        open: state.counterexamples.filter((c) => c.status === "open"),
        resolved: state.counterexamples.filter((c) => c.status === "resolved"),
      },
      contributions,
      hasOpposingConclusions: supporting.length > 0 && refuting.length > 0,
    };
  }

  gatingStatus(hypothesisId) {
    const { state } = this.#load(hypothesisId);
    const labs = state.claims.map((c) => c.labId);
    return {
      hypothesisId,
      publicationStatus: state.publicationStatus,
      submissions: state.submissions.size,
      unsealedSubmissions: [...state.slots.values()].filter((s) => s.submission && s.unsealed).length,
      perLab: labs.map((labId) => ({
        labId,
        dataAuthorized: state.dataApprovals.has(labId),
        authorshipApproved: state.authorshipApprovals.has(labId),
      })),
      dataReady: labs.every((labId) => state.dataApprovals.has(labId)),
      authorshipReady: labs.every((labId) => state.authorshipApprovals.has(labId)),
      openCounterexamples: state.counterexamples.filter((c) => c.status === "open").length,
    };
  }

  /**
   * 公开追溯视图：从任一主张可查到验证方案、执行团队、版本关系、
   * 综合证据以及尚未解决的反例。仅在发布后可获取。
   */
  trace(hypothesisId) {
    const { state } = this.#load(hypothesisId);
    if (state.publicationStatus !== "published") {
      throw new DomainError("NOT_PUBLISHED", "该主张尚未通过闸门公开，不能提供公开追溯", { hypothesisId });
    }
    return {
      hypothesis: {
        id: hypothesisId,
        title: state.title,
        cellSet: state.cellSet,
        predictions: state.predictions,
        falsifiers: state.falsifiers,
      },
      versionLineage: {
        sourceRun: state.source.runId,
        sourceFinding: state.source.findingId,
        model: state.source.model,
        claimedAgainst: state.source.modelVersion,
        preregistrationAmendments: state.amendments,
      },
      teams: state.claims.map((claim) => {
        const slot = state.slots.get(claim.labId);
        return {
          labId: claim.labId,
          claimedAt: claim.claimedAt,
          frozenProtocol: slot.preregistration
            ? {
                keySteps: slot.preregistration.keySteps,
                primaryEndpoints: slot.preregistration.primaryEndpoints,
                samplePlan: slot.preregistration.samplePlan,
                techniques: slot.preregistration.techniques,
                revisions: slot.preregistration.revisions,
              }
            : null,
          outcome: slot.executionStatus,
          submission: slot.submission,
        };
      }),
      synthesis: this.synthesis(hypothesisId).evidence,
      contributions: this.synthesis(hypothesisId).contributions,
      unresolvedCounterexamples: state.counterexamples.filter((c) => c.status === "open"),
      eventLog: this.store.forAggregate(hypothesisId).map(({ seq, type, actor, at, payload }) => ({
        seq,
        type,
        actor,
        at,
        payload,
      })),
    };
  }
}

export { applyEvent, replay, PAUSE_REASONS, PAUSE_LABEL };

/** 便捷工具：为原始材料计算 sha256 哈希。 */
export function hashRawMaterial(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}
