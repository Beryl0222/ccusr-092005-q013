import { fail } from "./errors.js";

/**
 * 从现有分析运行/数据集提出可反驳的实验主张。
 * 必须给出：适用细胞集合、至少一条预测现象、至少一条反例条件。
 * 来源记录与细胞集合引用的数据集都会校验，保证主张来自真实资料。
 */
export function proposeHypothesis(store, input) {
  const {
    title,
    sourceRecordId,
    cellSets,
    predictions,
    counterexamples,
    rationale = "",
    requiredCapabilities,
    proposedBy = null,
  } = input ?? {};

  if (typeof title !== "string" || title.trim() === "") {
    fail("validation_failed", "主张必须给出标题");
  }
  const source = store.records.get(sourceRecordId);
  if (!source) fail("unknown_source", `假设来源记录不存在: ${sourceRecordId}`);
  if (!Array.isArray(cellSets) || cellSets.length === 0) {
    fail("validation_failed", "主张必须给出适用细胞集合");
  }
  if (!Array.isArray(predictions) || predictions.length === 0) {
    fail("validation_failed", "主张必须给出至少一条预测现象");
  }
  if (!Array.isArray(counterexamples) || counterexamples.length === 0) {
    fail("validation_failed", "主张必须给出至少一条反例条件，保证结论可以被反驳");
  }

  const knownDatasets = collectKnownDatasets(store, source);
  const normalizedCellSets = cellSets.map((cellSet, index) =>
    normalizeCellSet(store, cellSet, index, knownDatasets),
  );

  const hypothesis = {
    id: store.nextId("hyp"),
    title: title.trim(),
    source: snapshotSource(store, source),
    cellSets: normalizedCellSets,
    predictions: predictions.map((statement, index) => ({
      id: `pred-${index + 1}`,
      statement: requireText(statement, `预测现象 ${index + 1}`),
    })),
    counterexamples: counterexamples.map((condition, index) => ({
      id: `cx-${index + 1}`,
      condition: requireText(condition, `反例条件 ${index + 1}`),
    })),
    rationale,
    requiredCapabilities: normalizeCapabilities(requiredCapabilities, normalizedCellSets),
    proposedBy,
    blinded: true,
    status: "open",
    createdAt: store.now(),
  };
  store.hypotheses.set(hypothesis.id, hypothesis);
  store.emit("hypothesis.proposed", { hypothesisId: hypothesis.id, sourceRecordId: source.id });
  return hypothesis;
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail("validation_failed", `${label}不能为空`);
  }
  return value.trim();
}

/** 已知数据集 = 全部 cell_dataset 记录 ∪ 来源运行直接涉及的数据集。 */
function collectKnownDatasets(store, source) {
  const known = new Set();
  for (const record of store.records.values()) {
    if (record.kind === "cell_dataset") known.add(record.id);
  }
  for (const id of source.datasets ?? []) known.add(id);
  return known;
}

function normalizeCellSet(store, cellSet, index, knownDatasets) {
  const datasetId = cellSet?.datasetId;
  if (typeof datasetId !== "string" || datasetId === "") {
    fail("validation_failed", `细胞集合 ${index + 1} 缺少数据集标识`);
  }
  if (!knownDatasets.has(datasetId)) {
    fail("unknown_dataset", `细胞集合 ${index + 1} 引用了未知数据集: ${datasetId}`);
  }
  const record = store.records.get(datasetId);
  return {
    datasetId,
    cellType: cellSet.cellType ?? record?.cell_type ?? null,
    species: cellSet.species ?? record?.species ?? null,
  };
}

/** 来源快照：模型、运行状态及各数据集的基因映射版本，供读者追溯版本关系。 */
function snapshotSource(store, source) {
  const datasetIds = Array.isArray(source.datasets) ? source.datasets : [source.id];
  return {
    recordId: source.id,
    kind: source.kind ?? null,
    model: source.model ?? null,
    state: source.state ?? null,
    datasets: datasetIds.map((id) => {
      const record = store.records.get(id);
      return {
        id,
        species: record?.species ?? null,
        cellType: record?.cell_type ?? null,
        geneMapVersion: record?.gene_map_version ?? null,
      };
    }),
  };
}

function normalizeCapabilities(required, cellSets) {
  const species =
    required?.species ?? [...new Set(cellSets.map((cellSet) => cellSet.species).filter(Boolean))];
  const techniques = required?.techniques ?? [];
  return { species: [...species], techniques: [...techniques] };
}
