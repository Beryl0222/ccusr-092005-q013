import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * 只追加事件存储。任何命令都不会更新或删除既有事实：
 * 暂停、失败、模型换版只会追加解释性事件，启动依据永远可回放。
 */
export class MemoryEventStore {
  #events = [];
  #versions = new Map();

  /** 以乐观并发控制追加事件；expectedVersion 为该聚合当前版本。 */
  append(event, expectedVersion) {
    const current = this.#versions.get(event.aggregateId) ?? 0;
    if (expectedVersion !== current) {
      const err = new Error(`并发修改冲突：聚合 ${event.aggregateId} 版本 ${current} 与期望 ${expectedVersion} 不一致`);
      err.code = "CONFLICT";
      throw err;
    }
    const seq = this.#events.length + 1;
    const stored = { ...event, seq };
    this.#events.push(stored);
    this.#versions.set(event.aggregateId, seq);
    return stored;
  }

  forAggregate(aggregateId) {
    return this.#events.filter((event) => event.aggregateId === aggregateId);
  }

  all() {
    return [...this.#events];
  }

  versionOf(aggregateId) {
    return this.#versions.get(aggregateId) ?? 0;
  }
}

/** JSONL 文件存储：每行一个事件，崩溃重启后可完整回放。 */
export class JsonlEventStore {
  #memory;

  constructor(file) {
    this.file = file;
    this.#memory = new MemoryEventStore();
    if (existsSync(file)) {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        this.#memory.append(JSON.parse(line), this.#memory.versionOf(JSON.parse(line).aggregateId));
      }
    } else {
      mkdirSync(dirname(file), { recursive: true });
    }
  }

  append(event, expectedVersion) {
    const stored = this.#memory.append(event, expectedVersion);
    appendFileSync(this.file, `${JSON.stringify(stored)}\n`);
    return stored;
  }

  forAggregate(aggregateId) {
    return this.#memory.forAggregate(aggregateId);
  }

  all() {
    return this.#memory.all();
  }

  versionOf(aggregateId) {
    return this.#memory.versionOf(aggregateId);
  }
}
