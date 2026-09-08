/**
 * WorkflowFileStore 单测：终态快照文件存储
 *
 * 覆盖：save→list 回环（原子写无 .tmp 残留）、目录缺失容错、
 * 损坏文件跳过、runId 白名单防路径穿越。
 */
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { WorkflowFileStore } from "../../src/modules/workflow/workflow-file-store.service";
import type { WorkflowRunSnapshot } from "../../src/modules/workflow/workflow.types";

describe("WorkflowFileStore（终态快照文件存储）", () => {
  const TMP = path.join(os.tmpdir(), `wf-store-spec-${Date.now()}`);
  let store: WorkflowFileStore;

  beforeAll(() => {
    process.env.SESSION_DATA_DIR = TMP;
    store = new WorkflowFileStore();
  });

  afterAll(async () => {
    delete process.env.SESSION_DATA_DIR;
    await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
  });

  const snap = (runId: string, over: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot => ({
    runId,
    name: `n-${runId}`,
    status: "completed",
    agents: [],
    logs: [],
    startedAt: 1,
    lastSeq: 1,
    ...over,
  });

  it("save → list 回环（原子写无 .tmp 残留）", async () => {
    await store.saveRunSnapshot("s1", snap("wfr_1", { result: { ok: true } }));
    await store.saveRunSnapshot("s1", snap("wfr_2", { status: "failed", errorCode: "X" }));

    const list = await store.listRunSnapshots("s1");
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.runId === "wfr_1")?.result).toEqual({ ok: true });
    expect(list.find((s) => s.runId === "wfr_2")?.errorCode).toBe("X");

    const files = await fs.readdir(path.join(TMP, "sessions", "s1", "workflows"));
    expect(files.every((f) => !f.endsWith(".tmp"))).toBe(true);
  });

  it("会话无 workflows 目录 → []（不抛错）", async () => {
    expect(await store.listRunSnapshots("s_missing")).toEqual([]);
  });

  it("损坏文件跳过并继续列出其余快照", async () => {
    await store.saveRunSnapshot("s2", snap("wfr_ok"));
    await fs.writeFile(
      path.join(TMP, "sessions", "s2", "workflows", "wfr_broken.json"),
      "{oops",
      "utf-8",
    );
    const list = await store.listRunSnapshots("s2");
    expect(list.map((s) => s.runId)).toEqual(["wfr_ok"]);
  });

  it("非法 runId 拒绝写入（防路径穿越）", async () => {
    await expect(
      store.saveRunSnapshot("s3", snap("../evil")),
    ).rejects.toThrow(/invalid workflow runId/);
  });
});
