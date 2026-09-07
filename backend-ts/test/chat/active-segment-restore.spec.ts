/**
 * 活跃段 manifest 懒恢复（重启安全）回归测试
 *
 * 背景：activeSegments 是纯内存缓存（仅 createSession/splitSegment 写入），进程重启后为空。
 * 此前写路径在未命中时硬编码回退 'seg-0000.jsonl'——已分卷的会话重启后再追加会写进
 * 已归档的 seg-0000（seq 远超该段末尾 → getAllEvents 判真缺口，会话永久无法加载）；
 * 且 getActiveSegmentInfo 返回 null（按字节分卷静默失效）、splitSegment 直接 no-op。
 *
 * 修复：写路径统一走 ensureActiveSegment——内存未命中时从 manifest 恢复活跃段
 * （endSeq/bytes 由段尾扫描补齐），覆盖 appendEvent/appendEvents/readEvents/
 * getActiveSegmentInfo/splitSegment/recordCompaction/truncateActiveSegment。
 */
/// <reference types="jest" />
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { JsonlBackend } from "../../src/common/persistence/jsonl-backend";
import { JsonlMessageService } from "../../src/common/persistence/jsonl-message.service";
import type { Message } from "../../src/common/types/conversation.types";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "seg-restore-test-"));
  process.env.SESSION_DATA_DIR = tmpDir;
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.SESSION_DATA_DIR;
});

function userMessage(id: string): Message {
  return {
    id,
    role: "user",
    kind: "user",
    source: { kind: "user" },
    metadata: {},
    content: [{ type: "text", text: "q" }],
  } as Message;
}

/** 段文件行数 */
function lineCount(sid: string, file: string): number {
  const dir = path.join(tmpDir, "sessions", sid);
  return fs
    .readFileSync(path.join(dir, file), "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0).length;
}

/** 全卷读取并断言 seq 严格连续（有任何缺口/重复 getAllEvents 会抛 CorruptSessionLogError） */
async function expectConsecutiveSeq(backend: JsonlBackend, sid: string): Promise<number[]> {
  const events = await backend.getAllEvents(sid);
  const seqs = events.map((e) => e.seq);
  for (let i = 1; i < seqs.length; i++) {
    expect(seqs[i]).toBe(seqs[i - 1] + 1);
  }
  return seqs;
}

describe("活跃段 manifest 懒恢复（重启安全）", () => {
  const sid = "seg-restore";
  let backend1: JsonlBackend;

  beforeEach(async () => {
    backend1 = new JsonlBackend();
    if (await backend1.hasSession(sid)) await backend1.deleteSession(sid);
    await backend1.createSession(sid, { title: "t" });
  });

  it("重启后追加写进 manifest 活跃段（seg-0001），不再落进已归档的 seg-0000", async () => {
    // 重启前：一回合 + 分卷（seg-0001 成为活跃段，首条 session/rotate）
    const s1 = new JsonlMessageService(backend1);
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [userMessage("u1")]);
    await s1.finalizeTurn(sid, turnId, 1, {
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await backend1.splitSegment(sid);

    const seg0LinesBefore = lineCount(sid, "seg-0000.jsonl");
    const seg1LinesBefore = lineCount(sid, "seg-0001.jsonl");
    expect(seg1LinesBefore).toBe(1); // 仅 session/rotate

    // 模拟进程重启：全新 backend 实例 = 内存 activeSegments 为空
    const backend2 = new JsonlBackend();
    const s2 = new JsonlMessageService(backend2);
    const { turnId: turnId2 } = await s2.beginTurn(sid);
    await s2.appendMessages(sid, [userMessage("u2")]);
    await s2.finalizeTurn(sid, turnId2, 1, {
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    // seg-0000（归档段）未被追加；seg-0001（活跃段）追加了 turn/start + user/message + turn/finish
    expect(lineCount(sid, "seg-0000.jsonl")).toBe(seg0LinesBefore);
    expect(lineCount(sid, "seg-0001.jsonl")).toBe(seg1LinesBefore + 3);

    // 全卷 seq 严格连续（修复前这里会抛「seq 缺口」）
    await expectConsecutiveSeq(backend2, sid);
  });

  it("重启后 getActiveSegmentInfo 从 manifest 恢复（分卷判断不再静默失效）", async () => {
    const s1 = new JsonlMessageService(backend1);
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [userMessage("u1")]);
    await s1.finalizeTurn(sid, turnId, 1, {
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await backend1.splitSegment(sid);

    const backend2 = new JsonlBackend();
    const info = await backend2.getActiveSegmentInfo(sid);
    expect(info).not.toBeNull();
    expect(info!.file).toBe("seg-0001.jsonl");
    expect(info!.bytes).toBeGreaterThan(0);
    expect(info!.endSeq).not.toBeNull();
  });

  it("重启后 splitSegment 正常工作：新段 startSeq = 恢复的 endSeq + 1，全卷 seq 连续", async () => {
    const s1 = new JsonlMessageService(backend1);
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [userMessage("u1")]);
    await s1.finalizeTurn(sid, turnId, 1, {
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await backend1.splitSegment(sid);

    // 重启后直接分卷（endSeq 由段尾扫描补齐）
    const backend2 = new JsonlBackend();
    await backend2.splitSegment(sid);

    const manifest = await backend2.readManifest(sid);
    const active = manifest.segments.find((s) => s.status === "active");
    expect(active?.file).toBe("seg-0002.jsonl");

    // seg-0002 首条 session/rotate 的 seq = seg-0001 末条 + 1
    const seg2First = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "sessions", sid, "seg-0002.jsonl"), "utf-8").split("\n")[0],
    );
    const events = await backend2.getAllEvents(sid);
    const lastSeqBeforeRotate = events[events.length - 2].seq; // rotate 是最后一条
    expect(seg2First.seq).toBe(lastSeqBeforeRotate + 1);
    expect(seg2First.type).toBe("session/rotate");

    // 全卷 seq 严格连续
    const seqs = events.map((e) => e.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it("重启后 torn 尾修复截断的是活跃段而非归档段", async () => {
    const s1 = new JsonlMessageService(backend1);
    const { turnId } = await s1.beginTurn(sid);
    await s1.appendMessages(sid, [userMessage("u1")]);
    await s1.finalizeTurn(sid, turnId, 1, {
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });
    await backend1.splitSegment(sid);
    const seg0Lines = lineCount(sid, "seg-0000.jsonl");

    // 模拟崩溃：活跃段（seg-0001）写入半条记录
    fs.appendFileSync(
      path.join(tmpDir, "sessions", sid, "seg-0001.jsonl"),
      `{"type":"turn/start","seq":999,"dat`,
      "utf-8",
    );

    // 重启后冷加载：修复路径应截断 seg-0001，seg-0000 完好
    const backend2 = new JsonlBackend();
    const s2 = new JsonlMessageService(backend2);
    await (s2 as any).getState(sid);

    expect(lineCount(sid, "seg-0000.jsonl")).toBe(seg0Lines);
    const { truncateTo, gap } = await backend2.scanActiveSegment(sid);
    expect(truncateTo).toBeNull();
    expect(gap).toBeNull();
    await expectConsecutiveSeq(backend2, sid);
  });
});
