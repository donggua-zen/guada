/**
 * SessionContentSearchService 单测：JSONL 实时内容搜索（替代 FTS5）
 *
 * 覆盖：命中/未命中、大小写折叠、多词 AND、turn/delete 不可搜、
 * 压缩裁剪原文可搜（展示链路）、系统注入/模型注入不可搜、
 * 批扫描游标推进、无 JSONL 目录守卫、单会话损坏跳过、snippet 形状。
 *
 * fixture 用真实 JsonlBackend 写入临时目录（SESSION_DATA_DIR）。
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { SessionContentSearchService } from "../../src/common/search/session-content-search.service";
import type { BaseEvent } from "../../src/common/persistence/types";

describe("SessionContentSearchService（JSONL 实时内容搜索）", () => {
  const TMP = path.join(os.tmpdir(), `content-search-spec-${Date.now()}`);
  let backend: JsonlBackend;
  let service: SessionContentSearchService;

  beforeAll(() => {
    process.env.SESSION_DATA_DIR = TMP;
    backend = new JsonlBackend();
    service = new SessionContentSearchService(backend);
  });

  afterAll(async () => {
    delete process.env.SESSION_DATA_DIR;
    await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  });

  /** 事件流游标（createSession 已写 session/init 占 seq=0） */
  const seqs = new Map<string, number>();
  const nextSeq = (sessionId: string) => (seqs.get(sessionId) ?? 0) + 1;

  /** 写一个完整回合：turn/start → user/message → assistant/message → turn/finish */
  async function writeTurn(
    sessionId: string,
    opts: {
      turnId: string;
      userText?: string;
      userKind?: "user" | "model";
      userBlocks?: Array<any>;
      assistantText?: string;
    },
  ): Promise<{ userMessageId: string; assistantMessageId: string }> {
    const base = nextSeq(sessionId);
    const userMessageId = `m_${sessionId}_${base + 1}`;
    const assistantMessageId = `a_${sessionId}_${base + 2}`;
    const t = Date.now();
    const events: BaseEvent[] = [
      {
        type: "turn/start",
        seq: base,
        time: t,
        data: { turnId: opts.turnId, kind: "turn" },
      },
      {
        type: "user/message",
        seq: base + 1,
        time: t,
        data: {
          messageId: userMessageId,
          kind: opts.userKind ?? "user",
          blocks: opts.userBlocks ?? [{ type: "text", text: opts.userText ?? "" }],
        },
      },
      {
        type: "assistant/message",
        seq: base + 2,
        time: t,
        data: {
          messageId: assistantMessageId,
          content: [{ type: "text", text: opts.assistantText ?? "" }],
        },
      },
      {
        type: "turn/finish",
        seq: base + 3,
        time: t,
        data: { turnId: opts.turnId, promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
    ];
    seqs.set(sessionId, base + 3);
    await backend.appendEvents(sessionId, events);
    return { userMessageId, assistantMessageId };
  }

  async function createSession(sessionId: string) {
    await backend.createSession(sessionId);
    seqs.set(sessionId, 0);
  }

  it("基本命中：用户消息文本 + snippet【】标记", async () => {
    await createSession("s_basic");
    await writeTurn("s_basic", {
      turnId: "t1",
      userText: "今天天气不错",
      assistantText: "好的，出门记得带伞",
    });

    const { matches } = await service.scanBatch("天气", ["s_basic"], 0, 10);
    expect(matches.has("s_basic")).toBe(true);
    expect(matches.get("s_basic")).toContain("【天气】");
  });

  it("大小写折叠 + assistant 消息命中 + 多词 AND（同一条消息内全含）", async () => {
    await createSession("s_case");
    await writeTurn("s_case", {
      turnId: "t1",
      userText: "hello",
      assistantText: "Say HELLO World loudly",
    });

    // 多词 AND 命中（同一 assistant 消息内同时含 hello + world，忽略大小写）
    const hit = await service.scanBatch("hello world", ["s_case"], 0, 10);
    expect(hit.matches.has("s_case")).toBe(true);

    // AND 不满足：词分属不同消息 → 不命中
    await createSession("s_and_miss");
    await writeTurn("s_and_miss", { turnId: "t1", userText: "苹果" });
    await writeTurn("s_and_miss", { turnId: "t2", userText: "香蕉" });
    const miss = await service.scanBatch("苹果 香蕉", ["s_and_miss"], 0, 10);
    expect(miss.matches.has("s_and_miss")).toBe(false);
  });

  it("turn/delete 后不可搜；压缩裁剪原文可搜（展示链路）", async () => {
    await createSession("s_delete");
    await writeTurn("s_delete", {
      turnId: "t1",
      userText: "机密内容一去不返",
      assistantText: "回复",
    });
    await writeTurn("s_delete", { turnId: "t2", userText: "新话题" });
    await backend.appendEvent("s_delete", {
      type: "turn/delete",
      seq: nextSeq("s_delete"),
      time: Date.now(),
      data: { turnId: "t1" },
    });

    const { matches } = await service.scanBatch("机密内容", ["s_delete"], 0, 10);
    expect(matches.has("s_delete")).toBe(false);

    // 压缩自动裁剪（head_tail_500）：展示链路不应用 → 原文仍可搜
    await createSession("s_prune");
    const turn = await writeTurn("s_prune", {
      turnId: "t1",
      userText: "需要检索的原始长文内容标记词",
    });
    await backend.appendEvent("s_prune", {
      type: "message/prune",
      seq: nextSeq("s_prune"),
      time: Date.now(),
      data: {
        messageId: turn.userMessageId,
        newContent: "（已裁剪）",
        prunedBytes: 100,
        strategy: "head_tail_500",
      },
    });

    const pruned = await service.scanBatch("原始长文内容", ["s_prune"], 0, 10);
    expect(pruned.matches.has("s_prune")).toBe(true);

    // user_edit 裁剪两链路一致应用 → 旧文本不可搜
    await createSession("s_edit");
    const edit = await writeTurn("s_edit", {
      turnId: "t1",
      userText: "编辑前的文本特征词",
    });
    await backend.appendEvent("s_edit", {
      type: "message/prune",
      seq: nextSeq("s_edit"),
      time: Date.now(),
      data: {
        messageId: edit.userMessageId,
        newContent: "编辑后的文本",
        prunedBytes: 10,
        strategy: "user_edit",
      },
    });
    const edited = await service.scanBatch("编辑前的文本", ["s_edit"], 0, 10);
    expect(edited.matches.has("s_edit")).toBe(false);
  });

  it("模型注入 user 消息与系统注入块不可搜", async () => {
    await createSession("s_inject");
    await writeTurn("s_inject", {
      turnId: "t1",
      userKind: "model",
      userText: "自动注入的系统提示词内容",
      assistantText: "收到",
    });
    await writeTurn("s_inject", {
      turnId: "t2",
      userBlocks: [{ type: "text", text: "正常输入", origin: "system" }],
    });

    // kind='model' 的注入消息不搜
    const inject = await service.scanBatch("系统提示词", ["s_inject"], 0, 10);
    expect(inject.matches.has("s_inject")).toBe(false);
    // origin='system' 的注入块不搜
    const sysBlock = await service.scanBatch("正常输入", ["s_inject"], 0, 10);
    expect(sysBlock.matches.has("s_inject")).toBe(false);
  });

  it("压缩括号忽略：被压缩消息仍可搜，摘要不入索引", async () => {
    await createSession("s_compact");
    // 回合1：将被压缩的旧消息
    const old = await writeTurn("s_compact", {
      turnId: "t1",
      userText: "被压缩的旧消息特征词",
      assistantText: "旧回复",
    });
    // 回合2：保留的新消息
    await writeTurn("s_compact", { turnId: "t2", userText: "新话题内容" });
    // 压缩括号：遮蔽前 2 条（旧 user + 旧 assistant）+ 摘要置头
    let compactionSeq = nextSeq("s_compact");
    for (const type of ["compaction/start", "compaction/summary", "compaction/end"]) {
      await backend.appendEvent("s_compact", {
        type: type as BaseEvent["type"],
        seq: compactionSeq,
        time: Date.now(),
        data:
          type === "compaction/summary"
            ? {
                shadowedCount: 2,
                shadowedEndId: old.assistantMessageId,
                summary: "旧消息的摘要文本特征词",
                summaryMessageId: `summary_${old.assistantMessageId}`,
              }
            : {},
      });
      compactionSeq++;
    }

    // 被压缩的消息保留参与检索（对齐前端"标记不物理移除"的重建方式）
    const compacted = await service.scanBatch("旧消息特征词", ["s_compact"], 0, 10);
    expect(compacted.matches.has("s_compact")).toBe(true);
    // 摘要文本不参与检索（忽略压缩括号，摘要消息不插入折叠态）
    const summary = await service.scanBatch("摘要文本特征词", ["s_compact"], 0, 10);
    expect(summary.matches.has("s_compact")).toBe(false);
  });

  it("批扫描游标推进：跨批不重不漏", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = `s_batch_${i}`;
      ids.push(id);
      await createSession(id);
      await writeTurn(id, { turnId: "t1", userText: "批量扫描目标词" });
    }

    const all = new Map<string, string>();
    let offset = 0;
    const scannedList: number[] = [];
    while (true) {
      const { matches, scanned } = await service.scanBatch("批量扫描", ids, offset, 2);
      scannedList.push(scanned);
      for (const [k, v] of matches) all.set(k, v);
      offset += scanned;
      if (offset >= ids.length || scanned === 0) break;
    }
    expect(scannedList).toEqual([2, 2, 1]);
    expect(all.size).toBe(5);
  });

  it("无 JSONL 目录的会话跳过（不抛错）", async () => {
    const { matches, scanned } = await service.scanBatch(
      "任意词",
      ["s_missing_dir"],
      0,
      10,
    );
    expect(scanned).toBe(1);
    expect(matches.size).toBe(0);
  });

  it("单会话日志损坏（seq 缺口）跳过，其余会话不受影响", async () => {
    await createSession("s_broken");
    await writeTurn("s_broken", { turnId: "t1", userText: "损坏会话内容" });
    // 直接向活跃段追加一条跳号事件 → getAllEvents 抛 CorruptSessionLogError
    const segFile = path.join(TMP, "sessions", "s_broken", "seg-0000.jsonl");
    await fs.appendFile(
      segFile,
      JSON.stringify({ type: "user/message", seq: 99, time: Date.now(), data: {} }) + "\n",
      "utf-8",
    );

    await createSession("s_good");
    await writeTurn("s_good", { turnId: "t1", userText: "健康会话内容" });

    const { matches } = await service.scanBatch(
      "会话内容",
      ["s_broken", "s_good"],
      0,
      10,
    );
    expect(matches.has("s_broken")).toBe(false);
    expect(matches.has("s_good")).toBe(true);
  });

  it("长文本 snippet：截断处带省略号，命中词【】包裹", async () => {
    await createSession("s_long");
    const longText = "前".repeat(60) + "关键词" + "后".repeat(60);
    await writeTurn("s_long", { turnId: "t1", userText: longText });

    const { matches } = await service.scanBatch("关键词", ["s_long"], 0, 10);
    const snippet = matches.get("s_long") ?? "";
    expect(snippet.startsWith("...")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
    expect(snippet).toContain("【关键词】");
    expect(snippet.length).toBeLessThan(longText.length);
  });

  it("空关键词 / 空白词元 → 空结果", async () => {
    const { matches, scanned } = await service.scanBatch("   ", ["s_basic"], 0, 10);
    expect(matches.size).toBe(0);
    expect(scanned).toBe(0);
  });
});
