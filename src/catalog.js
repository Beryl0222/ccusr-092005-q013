import { readFile } from "node:fs/promises";

import { DomainError } from "./errors.js";

/**
 * 目录层：索引现有数据集、分析运行（如 UCE）及其产生的发现。
 * 假设只能引用目录中真实存在的运行与发现，保证假设来源可追溯。
 */
export async function loadCatalog(path = "fixtures/seed.json") {
  const raw = JSON.parse(await readFile(path, "utf8"));
  if (!raw.project || !Array.isArray(raw.records) || raw.records.length === 0) {
    throw new Error("领域样例缺少项目名称或记录");
  }

  const datasets = new Map();
  const runs = new Map();
  const findings = new Map();

  for (const record of raw.records) {
    if (!record.id) throw new DomainError("CATALOG_INVALID", "记录缺少稳定标识", { record });
    if (record.kind === "cell_dataset") {
      datasets.set(record.id, record);
    } else if (record.kind === "analysis_run") {
      runs.set(record.id, record);
    }
  }

  for (const run of runs.values()) {
    for (const datasetId of run.datasets ?? []) {
      if (!datasets.has(datasetId)) {
        throw new DomainError(
          "CATALOG_DANGLING_DATASET",
          `分析运行 ${run.id} 引用了不存在的数据集 ${datasetId}`,
          { runId: run.id, datasetId },
        );
      }
    }
    for (const finding of run.findings ?? []) {
      if (!finding.id) {
        throw new DomainError("CATALOG_INVALID", `运行 ${run.id} 的发现缺少标识`, { runId: run.id });
      }
      for (const datasetId of finding.cell_set ?? []) {
        if (!datasets.has(datasetId)) {
          throw new DomainError(
            "CATALOG_DANGLING_DATASET",
            `发现 ${finding.id} 引用了不存在的数据集 ${datasetId}`,
            { findingId: finding.id, datasetId },
          );
        }
        if (!(run.datasets ?? []).includes(datasetId)) {
          throw new DomainError(
            "CATALOG_FINDING_OUTSIDE_RUN",
            `发现 ${finding.id} 的细胞集合不在运行 ${run.id} 的输入范围内`,
            { findingId: finding.id, runId: run.id, datasetId },
          );
        }
      }
      findings.set(finding.id, { ...finding, runId: run.id, model: run.model, modelVersion: run.model_version });
    }
  }

  return {
    project: raw.project,
    datasets,
    runs,
    findings,
    getDataset(id) {
      const dataset = datasets.get(id);
      if (!dataset) throw new DomainError("UNKNOWN_DATASET", `目录中不存在数据集 ${id}`, { datasetId: id });
      return dataset;
    },
    getRun(id) {
      const run = runs.get(id);
      if (!run) throw new DomainError("UNKNOWN_RUN", `目录中不存在分析运行 ${id}`, { runId: id });
      return run;
    },
    getFinding(id) {
      const finding = findings.get(id);
      if (!finding) throw new DomainError("UNKNOWN_FINDING", `目录中不存在发现 ${id}`, { findingId: id });
      return finding;
    },
  };
}
