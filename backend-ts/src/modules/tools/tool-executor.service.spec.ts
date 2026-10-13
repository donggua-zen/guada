import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ToolExecutor } from "./tool-executor.service";
import type { ISessionContext } from "../chat/session-context";

/**
 * 大结果处理与 meta 的关系：正文未超阈值时原样返回，meta 必须保留。
 *
 * 这是分支会话还原 TODO 的前提——todo 结果很短、永不触发 spill，若此处仍无条件
 * 丢弃 meta，分支就拿不到锚点时刻的 TODO。只有正文真被替换（spill/截断）时，
 * meta 才因与正文失配而被丢弃。
 */

const META = {
  card: "todo",
  action: "update",
  items: [{ content: "第一步", status: "pending" }],
};

/** 造一个只含单个工具的已决议插件信息 */
function makeSession(
  workspacePath: string | null,
  handler: (args: any, ctx: any, signal?: AbortSignal) => any,
  toolExtra: Record<string, any> = {},
): ISessionContext {
  const resolved = [
    {
      enabled: true,
      effective: "global",
      plugin: {
        id: "test-plugin",
        name: "test",
        description: "",
        version: "1.0.0",
        category: "core",
      },
      enabledTools: [
        {
          name: "todo",
          description: "todo tool",
          parameters: { type: "object", properties: {} },
          handler,
          toolSet: "todo",
          ...toolExtra,
        },
      ],
      allTools: [],
      enabledToolKits: [],
      workspaceProviders: [],
      attachmentTypes: [],
    },
  ];
  return {
    workspacePath,
    getResolvedPlugins: () => resolved,
  } as unknown as ISessionContext;
}

/** tokenizer 固定返回给定 token 数，用于控制是否跨过 spill 阈值（20000） */
function makeExecutor(tokenCount: number): ToolExecutor {
  return new ToolExecutor({} as any, {
    countTextTokens: async () => tokenCount,
  } as any);
}

describe("ToolExecutor 大结果处理与 meta", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tool-executor-spec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("正文未超阈值：原样返回且 meta 保留", async () => {
    const executor = makeExecutor(100);
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-1",
      makeSession(tmpRoot, async () => ({ content: "列表文本", meta: META })),
    );

    expect(res.content).toBe("列表文本");
    expect(res.meta).toEqual(META);
    expect(res.isError).toBe(false);
  });

  it("正文超阈值：spill 到文件，meta 丢弃", async () => {
    const executor = makeExecutor(99999);
    const bigContent = "x".repeat(500);
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-2",
      makeSession(tmpRoot, async () => ({ content: bigContent, meta: META })),
    );

    expect(res.meta).toBeUndefined();
    expect(res.content).not.toBe(bigContent);
    const spilled = JSON.parse(res.content);
    expect(spilled.file_path).toContain(path.join(".guada", "tools_output"));
    expect(
      fs.readFileSync(path.join(tmpRoot, spilled.file_path), "utf-8"),
    ).toBe(bigContent);
  });

  it("正文超阈值且无工作目录：替换为告警 JSON，meta 丢弃", async () => {
    const executor = makeExecutor(99999);
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-3",
      makeSession(null, async () => ({ content: "x".repeat(500), meta: META })),
    );

    expect(res.meta).toBeUndefined();
    expect(JSON.parse(res.content).warning).toContain("无法保存到工作目录");
  });

  it("正文超阈值：与正文无关的 meta.link 仍保留，其余字段随正文丢弃", async () => {
    const executor = makeExecutor(99999);
    const link = { type: "sub_agent", subSessionId: "sub-1", name: "分析架构" };
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-5",
      makeSession(tmpRoot, async () => ({
        content: "y".repeat(500),
        meta: { ...META, link },
      })),
    );

    // link 指向会话而非正文内容，不存在失配问题；丢了它会让子代理的长报告恰好
    // 失去"打开子代理面板"入口——而长报告正是最想点进去回看的场景
    expect(res.meta).toEqual({ link });
  });

  it("返回纯字符串的工具不受影响（无 meta 可丢）", async () => {
    const executor = makeExecutor(100);
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-4",
      makeSession(tmpRoot, async () => "纯文本结果"),
    );

    expect(res.content).toBe("纯文本结果");
    expect(res.meta).toBeUndefined();
  });

  it("声明 exemptFromLargeResult 的工具：超阈值仍原样返回，meta 保留", async () => {
    const executor = makeExecutor(99999);
    const bigContent = "z".repeat(500);
    const res = await executor.executeTool(
      "todo",
      {},
      "tc-6",
      makeSession(tmpRoot, async () => ({ content: bigContent, meta: META }), {
        exemptFromLargeResult: true,
      }),
    );

    // 自管长度的工具（read / skill_learn）：正文就是模型要用的内容，
    // 被换成 2048 字符预览等于报废，通用裁剪必须放行
    expect(res.content).toBe(bigContent);
    expect(res.meta).toEqual(META);
  });
});
