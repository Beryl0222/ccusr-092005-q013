import { createServer } from "node:http";

import { loadCatalog } from "./catalog.js";
import { Hub } from "./hub.js";
import { JsonlEventStore } from "./store.js";
import { createApi } from "./api.js";

/**
 * 启动假设验证协作后端。
 * 事件持久化到 data/events.jsonl，重启后从只追加日志完整回放，
 * 暂停说明、失败复现、修订与撤销记录均不会丢失。
 */
export async function createApp({
  catalogPath = "fixtures/seed.json",
  eventFile = "data/events.jsonl",
} = {}) {
  const catalog = await loadCatalog(catalogPath);
  const store = new JsonlEventStore(eventFile);
  const hub = new Hub({ catalog, store });
  return createApi(hub, catalog);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8080);
  const app = await createApp();
  createServer(app).listen(port, () => {
    console.log(`假设验证协作后端已启动：http://localhost:${port}`);
  });
}
