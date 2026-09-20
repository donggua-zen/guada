import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SessionService } from "./session.service";
import { SessionMetaStore } from "./session-meta.store";
import {
  META_DOMAIN_SESSIONS,
  MetadataBootstrapGate,
} from "../../common/database/metadata-bootstrap.gate";

/**
 * fork 子会话克隆（cloneSubSessionForBranch）集成契约
 *
 * 覆盖：整目录克隆（事件/附件随迁）、目录内引用改写（自引用 + 对原父的引用）、
 * 元数据行克隆（显式新 id、parentId 指向新分支、rootId 自动解析、冻结态与溯源保留）、
 * 源子会话目录不被触碰。
 */
describe("SessionService cloneSubSessionForBranch", () => {
  let tmpRoot: string;
  let sessionsBase: string;
  let store: SessionMetaStore;
  let service: SessionService;

  const sessionDir = (id: string) => path.join(sessionsBase, id);

  const writeEventLog = (id: string, events: any[]) => {
    fs.mkdirSync(sessionDir(id), { recursive: true });
    const body = events
      .map((e, i) => JSON.stringify({ seq: i, time: 1700000000000 + i, ...e }))
      .join("\n");
    fs.writeFileSync(path.join(sessionDir(id), "seg-0000.jsonl"), body);
  };

  beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-clone-spec-"));
    sessionsBase = path.join(tmpRoot, "sessions");
    fs.mkdirSync(sessionsBase, { recursive: true });
    process.env.SESSION_DATA_DIR = tmpRoot;

    const gate = new MetadataBootstrapGate();
    gate.complete(META_DOMAIN_SESSIONS);
    store = new SessionMetaStore(gate);
    await store.initialize();

    // SessionService 依赖极多，克隆路径只触达 sessionStore 与文件系统，其余以桩注入
    service = new SessionService(
      store,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  afterAll(() => {
    store.onModuleDestroy();
    delete process.env.SESSION_DATA_DIR;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("克隆子会话：目录随迁 + 自引用/父引用改写 + 元数据行克隆", async () => {
    const parentRow = await store.create({ id: "parent-src", title: "主会话", sessionType: "web" });
    const childRow = await store.create({
      id: "child-src",
      title: "子代理",
      sessionType: "sub_agent",
      parentId: "parent-src",
      closedAt: "2026-01-02T00:00:00.000Z",
      closeReason: "done",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      lastActiveAt: "2026-01-02T00:00:00.000Z",
      settings: { subAgent: { label: "reader" } },
      data: { cost: { tokens: 1234 } },
    });

    // 子会话目录：事件引用自己的图片 + 原父会话的预览图
    writeEventLog("child-src", [
      { type: "session/init", data: { title: "子代理" } },
      {
        type: "user/message",
        data: {
          blocks: [
            { attachment: { refType: "session", url: `sessions/child-src/images/pic.png` } },
            { attachment: { refType: "session", url: `sessions/parent-src/previews/p.png` } },
          ],
        },
      },
    ]);
    fs.mkdirSync(path.join(sessionDir("child-src"), "images"), { recursive: true });
    fs.writeFileSync(path.join(sessionDir("child-src"), "images", "pic.png"), "PNG");

    const forkParentId = String((await store.create({ title: "主会话 (fork)" })).id);
    const cloned = await (service as any).cloneSubSessionForBranch(
      store.get(forkParentId === "x" ? "" : "child-src"),
      forkParentId,
    );

    // 元数据行：新 id、新父、rootId 自动解析、冻结态与溯源保留
    expect(String(cloned.id)).toMatch(/^session-/);
    expect(cloned.id).not.toBe("child-src");
    expect(cloned.parentId).toBe(forkParentId);
    expect(store.getMeta(String(cloned.id))!.rootId).toBe(forkParentId);
    expect(cloned.closedAt).toEqual(new Date("2026-01-02T00:00:00.000Z"));
    expect(cloned.closeReason).toBe("done");
    expect(cloned.title).toBe("子代理");
    expect(cloned.settings).toEqual({ subAgent: { label: "reader" } });
    // 通用 data 扩展字段随克隆保留（settings 受管键重合成，其余键透传）
    expect(cloned.data).toEqual({
      cost: { tokens: 1234 },
      settings: { subAgent: { label: "reader" } },
    });

    // 目录克隆：事件 + 附件随迁，引用改写为自引用 + 新父
    const clonedSeg = fs.readFileSync(
      path.join(sessionDir(String(cloned.id)), "seg-0000.jsonl"),
      "utf8",
    );
    expect(clonedSeg).toContain(`sessions/${cloned.id}/images/pic.png`);
    expect(clonedSeg).toContain(`sessions/${forkParentId}/previews/p.png`);
    expect(clonedSeg).not.toContain("sessions/child-src/");
    expect(clonedSeg).not.toContain("sessions/parent-src/");
    expect(
      fs.readFileSync(path.join(sessionDir(String(cloned.id)), "images", "pic.png"), "utf8"),
    ).toBe("PNG");

    // 源子会话不被触碰
    const srcSeg = fs.readFileSync(path.join(sessionDir("child-src"), "seg-0000.jsonl"), "utf8");
    expect(srcSeg).toContain("sessions/child-src/images/pic.png");
    expect(srcSeg).toContain("sessions/parent-src/previews/p.png");
    expect(store.getMeta("child-src")!.parentId).toBe("parent-src");
    void parentRow;
    void childRow;
  });
});
