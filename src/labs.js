import { fail } from "./errors.js";

export function registerLab(store, { name, capabilities } = {}) {
  if (typeof name !== "string" || name.trim() === "") {
    fail("validation_failed", "实验室必须给出名称");
  }
  const lab = {
    id: store.nextId("lab"),
    name: name.trim(),
    capabilities: {
      species: [...(capabilities?.species ?? [])],
      techniques: [...(capabilities?.techniques ?? [])],
    },
    registeredAt: store.now(),
  };
  store.labs.set(lab.id, lab);
  store.emit("lab.registered", { labId: lab.id });
  return lab;
}

/** 认领门槛：实验室的样本与技术能力必须覆盖主张要求。 */
export function assertCapabilities(lab, required) {
  const missingSpecies = required.species.filter((s) => !lab.capabilities.species.includes(s));
  const missingTechniques = required.techniques.filter(
    (t) => !lab.capabilities.techniques.includes(t),
  );
  if (missingSpecies.length > 0 || missingTechniques.length > 0) {
    const parts = [];
    if (missingSpecies.length > 0) parts.push(`缺少样本: ${missingSpecies.join("、")}`);
    if (missingTechniques.length > 0) parts.push(`缺少技术: ${missingTechniques.join("、")}`);
    fail("capability_mismatch", `实验室「${lab.name}」不具备认领条件（${parts.join("；")}）`);
  }
}
