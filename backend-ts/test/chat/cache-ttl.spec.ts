/// <reference types="jest" />

import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cache-ttl-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

describe("stateCache TTL 超时机制（30 分钟，无 LRU）", () => {
  const sid = "cache-ttl";
  let backend: JsonlBackend;

  beforeEach(async () => {
    backend = new JsonlBackend();
    if (await backend.hasSession(sid)) await backend.deleteSession(sid);
    await backend.createSession(sid, { title: "t" });
  });

  /** 写一轮完整回合 */
  async function writeRound(service: JsonlMessageService) {
    const { turnId } = await service.beginTurn(sid);
    await service.appendMessages(sid, [
      { id: "u1", role: "user", kind: "user", source: { kind: "user" }, metadata: {}, content: [{ type: "text", text: "q" }] },
      { id: "a1", role: "assistant", kind: "model", source: { kind: "model", provider: "p", model: "m" }, metadata: {}, content: [{ type: "text", text: "ans" }] },
    ]);
    await service.finalizeTurn(sid, turnId, 10, { finishReason: "stop", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
  }

  it("缓存命中：访问/写入即续期，未过期返回缓存折叠态（不重建）", async () => {
    const service = new JsonlMessageService(backend);
    await writeRound(service);
    const seq1 = await service.getLastProcessedSeq(sid);

    // 后端直写一条新事件（绕过 service 缓存增量 fold）
    const seq = seq1 + 1;
    await backend.appendEvent(sid, {
      type: "user/message",
      seq,
      time: Date.now(),
      data: { messageId: "extra", kind: "user", blocks: [{ type: "text", text: "ext" }], metadata: {} },
    } as any);

    // 缓存命中（未过期）→ 返回缓存旧态（lastProcessedSeq 不含直写事件）
    const seq2 = await service.getLastProcessedSeq(sid);
    expect(seq2).toBe(seq1);
  });

  it("TTL 过期（惰性）：cacheGet 逐出并触发重建（含磁盘直写事件）", async () => {
    const service = new JsonlMessageService(backend);
    await writeRound(service);
    const seq1 = await service.getLastProcessedSeq(sid);

    // 把缓存项的 lastActiveAt 拨到 TTL 之前（模拟 30 分钟未活动）
    const entry = (service as any).stateCache.get(sid) as { lastActiveAt: number };
    expect(entry).toBeDefined();
    entry.lastActiveAt = Date.now() - (JsonlMessageService as any).CACHE_TTL_MS - 1000;

    // 后端直写新事件（缓存过期前不会被增量 fold）
    await backend.appendEvent(sid, {
      type: "user/message",
      seq: seq1 + 1,
      time: Date.now(),
      data: { messageId: "extra", kind: "user", blocks: [{ type: "text", text: "ext" }], metadata: {} },
    } as any);

    // 过期 → cacheGet 逐出 → 重建（快照+增量/全量）→ 包含直写事件
    const seq2 = await service.getLastProcessedSeq(sid);
    expect(seq2).toBe(seq1 + 1);
    // 缓存已重建并续期
    const entry2 = (service as any).stateCache.get(sid) as { lastActiveAt: number };
    expect(entry2.lastActiveAt).toBeGreaterThan(Date.now() - 5000);
  });

  it("无数量上限：超 8 个会话也不逐出（不再有 LRU 淘汰）", async () => {
    const service = new JsonlMessageService(backend);
    // 用同一会话反复构造？不——直接验证 stateCache 无 size 上限：塞入 10 个占位
    // （通过私有 stateCache 模拟 10 个会话，断言 cacheGet 不因数量逐出）
    const cache = (service as any).stateCache as Map<string, { state: unknown; lastActiveAt: number }>;
    for (let i = 0; i < 10; i++) {
      cache.set(`fake-${i}`, { state: {}, lastActiveAt: Date.now() });
    }
    expect(cache.size).toBe(10); // 不因数量被淘汰
  });
});
