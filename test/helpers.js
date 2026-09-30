import { loadSeed } from "../src/seed.js";
import { CollaborationService } from "../src/service.js";

export async function makeService() {
  const { records } = await loadSeed();
  return new CollaborationService({ records });
}

export const HASH_A = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const HASH_C = "c".repeat(64);

/** 主张 A：海绵领细胞 ↔ 青蛙神经元（源自 UCE 运行）。 */
export const HYP_A = {
  title: "海绵领细胞表达与青蛙神经元同源的转录模块",
  sourceRecordId: "embedding-run-uce-17",
  cellSets: [
    { datasetId: "dataset-sponge-choanocyte", cellType: "choanocyte" },
    { datasetId: "frog-neuron-08", cellType: "neuron", species: "青蛙" },
  ],
  predictions: ["scRNA-seq 中领细胞的神经元同源模块得分显著高于海绵其他细胞类型"],
  counterexamples: [
    "若模块得分不高于海绵其他细胞类型，则主张被反驳",
    "若得分差异可由批次或伪影解释，则主张被反驳",
  ],
  requiredCapabilities: { species: ["海绵", "青蛙"], techniques: ["scRNA-seq"] },
};

/** 主张 B：neuroid 细胞 → 腺体功能。 */
export const HYP_B = {
  title: "neuroid 细胞承担腺样分泌功能",
  sourceRecordId: "embedding-run-uce-17",
  cellSets: [{ datasetId: "dataset-sponge-choanocyte", cellType: "neuroid" }],
  predictions: ["neuroid 细胞中可检测到分泌颗粒与粘液基因共定位"],
  counterexamples: ["若 neuroid 细胞无分泌颗粒且粘液基因不表达，则主张被反驳"],
  requiredCapabilities: { species: ["海绵"], techniques: ["组织学"] },
};

export function registerLabs(svc) {
  return {
    joint: svc.registerLab({
      name: "跨物种联合实验室",
      capabilities: { species: ["海绵", "青蛙"], techniques: ["scRNA-seq", "smFISH"] },
    }),
    frog: svc.registerLab({
      name: "两爬神经实验室",
      capabilities: { species: ["青蛙", "海绵"], techniques: ["scRNA-seq", "电生理"] },
    }),
    spongeOnly: svc.registerLab({
      name: "海绵基础实验室",
      capabilities: { species: ["海绵"], techniques: ["scRNA-seq"] },
    }),
    gland: svc.registerLab({
      name: "腺体组织实验室",
      capabilities: { species: ["海绵"], techniques: ["组织学", "scRNA-seq"] },
    }),
  };
}
