import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { HttpException } from "@nestjs/common";
import { SessionService } from "./session.service";
import { SessionMetaStore } from "./session-meta.store";
import type { BaseEvent } from "../../common/persistence/types";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";
import { TODO_META_CARD } from "../../common/utils/todo-store.util";

/**
 * branchSession 主流程契约：只复制主对话。
 *
 * 覆盖：事件前缀按锚点截断并剔除 session/init 与 session/rotate、会话目录内附件
 * 随迁与引用改写、子代理子会话不再克隆、TODO 从锚点前最后一个 todo 工具结果的
 * meta 重建、锚点/类型/流式守卫、失败回滚。
 */

const SOURCE_ID = "session-src";

/** 内存版 IMessageStore：只实现分支路径触达的方法 */
class FakeMessageStore {
  private events = new Map<string, BaseEvent[]>();
  private nextSeq = new Map<string, number>();
  importCalls: Array<{ sessionId: string; events: BaseEvent[] }> = [];
  failImport = false;

  seed(sessionId: string, events: BaseEvent[]): void {
    this.events.set(sessionId, events.map((e) => ({ ...e })));
    this.nextSeq.set(
      sessionId,
      events.reduce((max, e) => Math.max(max, e.seq + 1), 0),
    );
  }

  has(sessionId: string): boolean {
    return this.events.has(sessionId);
  }

  async getAllEvents(sessionId: string): Promise<BaseEvent[]> {
    // 深拷贝：真实实现每次解析出新对象，分支会就地改这些对象
    return (this.events.get(sessionId) ?? []).map((e) =>
      JSON.parse(JSON.stringify(e)),
    );
  }

  async ensureSession(sessionId: string, opts?: { title?: string }): Promise<void> {
    if (this.events.has(sessionId)) return;
    this.events.set(sessionId, [
      {
        type: "session/init",
        seq: 0,
        time: Date.now(),
        data: { title: opts?.title },
      },
    ]);
    this.nextSeq.set(sessionId, 1);
  }

  async importEvents(
    sessionId: string,
    events: BaseEvent[],
  ): Promise<{ imported: number }> {
    if (this.failImport) throw new Error("import boom");
    let seq = this.nextSeq.get(sessionId) ?? 0;
    const stored = events.map((e) => ({ ...e, seq: seq++ }));
    this.events.set(sessionId, [
      ...(this.events.get(sessionId) ?? []),
      ...stored,
    ]);
    this.nextSeq.set(sessionId, seq);
    this.importCalls.push({ sessionId, events: stored });
    return { imported: stored.length };
  }

  async clearSessionTurns(sessionId: string): Promise<void> {
    this.events.delete(sessionId);
    this.nextSeq.delete(sessionId);
  }
}

/** 源会话事件：session/init → rotate → 回合A(含 todo 工具结果) → 回合B */
function buildSourceEvents(overrides?: {
  todoMetaItems?: unknown;
  omitTodoMeta?: boolean;
  /** 注入一条工具产出图片消息（agent-engine materializeToolImages 的持久化形态） */
  withToolImage?: boolean;
}): BaseEvent[] {
  const t = 1700000000000;
  const todoMeta = overrides?.omitTodoMeta
    ? undefined
    : {
        card: TODO_META_CARD,
        action: "update",
        items: overrides?.todoMetaItems ?? [
          { content: "第一步", status: "completed" },
          { content: "第二步", status: "in_progress" },
        ],
      };

  const events: BaseEvent[] = [
    { type: "session/init", seq: 0, time: t, data: { title: "主会话" } },
    { type: "session/rotate", seq: 1, time: t + 1, data: {} },
    {
      type: "turn/start",
      seq: 2,
      time: t + 2,
      data: { turnId: "turn-a", kind: "turn" },
    },
    {
      type: "user/message",
      seq: 3,
      time: t + 3,
      data: {
        messageId: "m-u1",
        kind: "user",
        blocks: [
          {
            type: "text",
            content: "看这张图",
            attachment: {
              refType: "session",
              url: `sessions/${SOURCE_ID}/images/pic.png`,
              previewUrl: `sessions/${SOURCE_ID}/previews/p.png`,
            },
          },
        ],
      },
    },
    {
      type: "assistant/message",
      seq: 4,
      time: t + 4,
      data: {
        messageId: "m-a1",
        content: [
          {
            type: "tool-call",
            toolCallId: "tc-1",
            name: "todo",
            arguments: '{"action":"update"}',
          },
        ],
      },
    },
    {
      type: "tool/result",
      seq: 5,
      time: t + 5,
      data: {
        messageId: "m-t1",
        toolCallId: "tc-1",
        name: "todo",
        content: "[x] 第一步\n[>] 第二步",
        ...(todoMeta ? { meta: todoMeta } : {}),
      },
    },
    {
      type: "turn/finish",
      seq: 6,
      time: t + 6,
      data: { turnId: "turn-a" },
    },
    // ↓ 锚点之后：分支必须完全看不到
    {
      type: "turn/start",
      seq: 7,
      time: t + 7,
      data: { turnId: "turn-b", kind: "turn" },
    },
    {
      type: "user/message",
      seq: 8,
      time: t + 8,
      data: { messageId: "m-u2", kind: "user", blocks: [{ type: "text", content: "第二轮" }] },
    },
    {
      type: "turn/finish",
      seq: 9,
      time: t + 9,
      data: { turnId: "turn-b" },
    },
  ];

  if (overrides?.withToolImage) {
    // 工具产出图片注入（agent-engine 物化后的落库形态）：user/message + kind=model
    // + metadata.hidden，blocks 内嵌 refType='session' 的 image 块——随 turn-a 前缀随迁
    events.splice(6, 0, {
      type: "user/message",
      seq: 6,
      time: t + 6,
      data: {
        messageId: "m-toolimg",
        kind: "model",
        blocks: [
          { type: "text", text: "Image loaded successfully." },
          {
            type: "image",
            attachment: {
              refType: "session",
              url: `sessions/${SOURCE_ID}/images/20261011/tool_shot.jpg`,
              previewUrl: `sessions/${SOURCE_ID}/previews/20261011/tool_shot.jpg`,
            },
          },
        ],
        metadata: { hidden: true },
      },
    });
    // 插入后按序重编 seq（保持与真实事件日志一致的单调连续）
    return events.map((e, i) => ({ ...e, seq: i }));
  }
  return events;
}

async function catchHttp(promise: Promise<unknown>): Promise<HttpException> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpException) return err;
    throw err;
  }
  throw new Error("预期抛出 HttpException，但调用成功了");
}

describe("SessionService.branchSession", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let workspaceRoot: string;
  let store: SessionMetaStore;
  let service: SessionService;
  let messages: FakeMessageStore;
  let streaming = new Set<string>();
  let failWorkspaceResolve = false;

  const sessionDir = (id: string) => path.join(sessionsBase, id);
  const todoFilePath = (workspaceDir: string, sessionId: string) =>
    path.join(workspaceDir, ".guada", "todo", `${sessionId}.json`);

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    workspaceRoot = path.join(tmpRoot, "workspaces");
    fs.mkdirSync(sessionsBase, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;
  });

  afterAll(() => {
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // 每个用例干净的会话库（目录随 tmpRoot 递归清理）
    fs.rmSync(sessionsBase, { recursive: true, force: true });
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.mkdirSync(sessionsBase, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = new SessionMetaStore(gate);
    await store.initialize();

    messages = new FakeMessageStore();
    streaming = new Set();
    failWorkspaceResolve = false;

    service = new SessionService(
      store,
      { findById: async () => null } as any, // agentStore
      {} as any, // modelStore
      {} as any, // settingsStorage
      {} as any, // llmService
      messages as any, // contextManager
      { toResourceAbsoluteUrl: (u: string) => u } as any, // urlService
      {
        resolveSessionWorkspaceDir: async (session: any) => {
          if (failWorkspaceResolve) throw new Error("workspace resolve boom");
          return path.join(workspaceRoot, String(session?.id ?? "unknown"));
        },
      } as any, // workspaceService
      {} as any, // sessionContextFactory
      {} as any, // workspaceWatcherService
      { hasActiveStream: (id: string) => streaming.has(id) } as any,
      {} as any, // compactionCoordinator
      {} as any, // eventBus
      {} as any, // sessionReplayService
      {} as any, // contentSearch
      {} as any, // sessionGroupService
    );
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  /** 建源会话 + 子代理子会话（含目录内容）+ 事件流 */
  async function seedSource(opts?: {
    todoMetaItems?: unknown;
    omitTodoMeta?: boolean;
    sessionType?: string;
    withToolImage?: boolean;
  }) {
    await store.create({
      id: SOURCE_ID,
      title: "主会话",
      sessionType: opts?.sessionType ?? "web",
    });
    await store.create({
      id: "session-child",
      title: "子代理",
      sessionType: "sub_agent",
      parentId: SOURCE_ID,
    });

    // 源会话目录内附件
    fs.mkdirSync(path.join(sessionDir(SOURCE_ID), "images"), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir(SOURCE_ID), "images", "pic.png"),
      "PNG",
    );
    fs.mkdirSync(path.join(sessionDir(SOURCE_ID), "previews"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sessionDir(SOURCE_ID), "previews", "p.png"),
      "PREVIEW",
    );
    // 工具产出图片的物理文件（引擎物化形态：images|previews 下的日期目录）
    if (opts?.withToolImage) {
      fs.mkdirSync(path.join(sessionDir(SOURCE_ID), "images", "20261011"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(sessionDir(SOURCE_ID), "images", "20261011", "tool_shot.jpg"),
        "TOOLIMG",
      );
      fs.mkdirSync(path.join(sessionDir(SOURCE_ID), "previews", "20261011"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(sessionDir(SOURCE_ID), "previews", "20261011", "tool_shot.jpg"),
        "TOOLPREVIEW",
      );
    }
    // 子代理目录内容（用于断言未被触碰）
    fs.mkdirSync(sessionDir("session-child"), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir("session-child"), "seg-0000.jsonl"),
      JSON.stringify({ type: "session/init", seq: 0 }) + "\n",
    );

    messages.seed(
      SOURCE_ID,
      buildSourceEvents({
        todoMetaItems: opts?.todoMetaItems,
        omitTodoMeta: opts?.omitTodoMeta,
        withToolImage: opts?.withToolImage,
      }),
    );
  }

  it("事件前缀按锚点截断，并剔除 session/init 与 session/rotate", async () => {
    await seedSource();

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });
    const imported = messages.importCalls.find(
      (c) => c.sessionId === branched.id,
    );
    expect(imported).toBeDefined();
    const types = imported!.events.map((e) => e.type);

    expect(types).toEqual([
      "turn/start",
      "user/message",
      "assistant/message",
      "tool/result",
      "turn/finish",
    ]);
    // 锚点之后的回合不可见
    expect(
      imported!.events.some(
        (e) => (e.data as { turnId?: string }).turnId === "turn-b",
      ),
    ).toBe(false);
    expect(types).not.toContain("session/init");
    expect(types).not.toContain("session/rotate");
    // seq 重编为连续，且从 1 起（0 被 session/init 占用）
    expect(imported!.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("子代理子会话不随分支复制，源子会话目录不被触碰", async () => {
    await seedSource();

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    expect(store.childrenOf(branched.id)).toEqual([]);
    // 除分支自身外不产生新会话行（源 + 子代理 + 分支 = 3）
    expect(store.query({}, "createdAsc").length).toBe(3);
    // 源子代理目录原样保留
    expect(
      fs.existsSync(path.join(sessionDir("session-child"), "seg-0000.jsonl")),
    ).toBe(true);
  });

  it("会话目录内附件随迁，事件内引用改写为新会话 id", async () => {
    await seedSource();

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    expect(
      fs.readFileSync(
        path.join(sessionDir(branched.id), "images", "pic.png"),
        "utf-8",
      ),
    ).toBe("PNG");
    expect(
      fs.readFileSync(
        path.join(sessionDir(branched.id), "previews", "p.png"),
        "utf-8",
      ),
    ).toBe("PREVIEW");

    const imported = messages.importCalls.find(
      (c) => c.sessionId === branched.id,
    )!;
    const userEvent = imported.events.find((e) => e.type === "user/message")!;
    const attachment = (
      userEvent.data as {
        blocks: Array<{ attachment: { url: string; previewUrl: string } }>;
      }
    ).blocks[0].attachment;

    expect(attachment.url).toBe(`sessions/${branched.id}/images/pic.png`);
    expect(attachment.previewUrl).toBe(`sessions/${branched.id}/previews/p.png`);
  });

  it("工具产出图片注入消息（hidden user/message）随迁：引用改写 + 物理文件拷贝", async () => {
    await seedSource({ withToolImage: true });

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    const imported = messages.importCalls.find(
      (c) => c.sessionId === branched.id,
    )!;
    const hiddenEvents = imported.events.filter(
      (e) =>
        e.type === "user/message" &&
        (e.data as { metadata?: { hidden?: boolean } }).metadata?.hidden ===
          true,
    );
    expect(hiddenEvents).toHaveLength(1);

    const blocks = (hiddenEvents[0].data as {
      blocks: Array<{
        type: string;
        attachment: { refType: string; url: string; previewUrl: string };
      }>;
    }).blocks;
    const imageBlock = blocks.find((b) => b.type === "image")!;
    expect(imageBlock.attachment.refType).toBe("session");
    expect(imageBlock.attachment.url).toBe(
      `sessions/${branched.id}/images/20261011/tool_shot.jpg`,
    );
    expect(imageBlock.attachment.previewUrl).toBe(
      `sessions/${branched.id}/previews/20261011/tool_shot.jpg`,
    );

    // 物理文件随会话目录拷入新会话
    expect(
      fs.readFileSync(
        path.join(sessionDir(branched.id), "images", "20261011", "tool_shot.jpg"),
        "utf-8",
      ),
    ).toBe("TOOLIMG");
    expect(
      fs.readFileSync(
        path.join(
          sessionDir(branched.id),
          "previews",
          "20261011",
          "tool_shot.jpg",
        ),
        "utf-8",
      ),
    ).toBe("TOOLPREVIEW");
  });

  it("TODO 从锚点前最后一个 todo 工具结果的 meta 重建到分支工作目录", async () => {
    await seedSource();

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    const filePath = todoFilePath(
      path.join(workspaceRoot, String(branched.id)),
      String(branched.id),
    );
    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, "utf-8"))).toEqual({
      items: [
        { content: "第一步", status: "completed" },
        { content: "第二步", status: "in_progress" },
      ],
    });
  });

  it("锚点前的 todo 结果无 meta（存量会话）→ 不写 TODO 文件", async () => {
    await seedSource({ omitTodoMeta: true });

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    expect(
      fs.existsSync(
        todoFilePath(
          path.join(workspaceRoot, String(branched.id)),
          String(branched.id),
        ),
      ),
    ).toBe(false);
  });

  it("最后一个 todo 的 meta.items 为空 → 不写 TODO 文件", async () => {
    await seedSource({ todoMetaItems: [] });

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    expect(
      fs.existsSync(
        todoFilePath(
          path.join(workspaceRoot, String(branched.id)),
          String(branched.id),
        ),
      ),
    ).toBe(false);
  });

  it("TODO 写盘失败不影响分支成功", async () => {
    await seedSource();
    failWorkspaceResolve = true;

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });

    expect(branched.id).toBeTruthy();
    expect(store.getMeta(String(branched.id))).toBeDefined();
    expect(
      messages.importCalls.some((c) => c.sessionId === branched.id),
    ).toBe(true);
  });

  it("锚点不存在（回合未完成）→ 400", async () => {
    await seedSource();

    const err = await catchHttp(
      service.branchSession(SOURCE_ID, { turnId: "turn-missing" }),
    );
    expect(err.getStatus()).toBe(400);
    // 未产生任何分支
    expect(store.query({}, "createdAsc").length).toBe(2);
  });

  it("非 web 会话 → 400", async () => {
    await seedSource({ sessionType: "bot" });

    const err = await catchHttp(
      service.branchSession(SOURCE_ID, { turnId: "turn-a" }),
    );
    expect(err.getStatus()).toBe(400);
  });

  it("源会话流式中 → 409", async () => {
    await seedSource();
    streaming.add(SOURCE_ID);

    const err = await catchHttp(
      service.branchSession(SOURCE_ID, { turnId: "turn-a" }),
    );
    expect(err.getStatus()).toBe(409);
  });

  it("子代理运行中不再阻止分支（守卫已移除）", async () => {
    await seedSource();
    streaming.add("session-child");

    const branched = await service.branchSession(SOURCE_ID, {
      turnId: "turn-a",
    });
    expect(branched.id).toBeTruthy();
  });

  it("事件导入失败 → 回滚半成品分支", async () => {
    await seedSource();
    messages.failImport = true;

    await expect(
      service.branchSession(SOURCE_ID, { turnId: "turn-a" }),
    ).rejects.toThrow("import boom");

    // 分支 meta 行与事件目录都被清掉；源会话与子代理不受影响
    const remaining = store.query({}, "createdAsc").map((s) => s.id);
    expect(remaining.sort()).toEqual(["session-child", SOURCE_ID].sort());
    expect(messages.has(SOURCE_ID)).toBe(true);
  });
});
