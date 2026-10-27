import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TodoPlugin } from "./todo.plugin";
import type { PluginContext } from "../types/plugin.types";
import { TODO_META_CARD } from "../../../common/utils/todo-store.util";

/**
 * todo 工具结果契约：content 给模型看，meta 携带「调用后的权威持久态」。
 *
 * meta.items 是分支会话还原锚点时刻 TODO 的唯一依据（见 todo-store.util），
 * 因此这里要钉死每个 action 的 meta.items 语义，尤其是两个易错边界：
 * - create 因多个 in_progress 被拒时文件已被清空 → items 必须是 []
 * - 全部完成时文件被删 → items 必须是 []（而 content 仍显示完成列表）
 */

/** 用假 api 捕获插件注册的工具定义，再取 execute */
async function loadTodoExecute(): Promise<
  (args: Record<string, any>, ctx: PluginContext) => Promise<any>
> {
  const plugin = new TodoPlugin({ emit: () => {} } as any);
  let captured: any;
  const api: any = {
    registerNls: () => {},
    registerTurnReminderProvider: () => {},
    registerToolKit: () => ({
      registerTool: (def: any) => {
        captured = def;
      },
    }),
  };
  await plugin.onLoad(api);
  return captured.execute;
}

describe("TodoPlugin 工具结果 meta", () => {
  let tmpRoot: string;
  let execute: (args: Record<string, any>, ctx: PluginContext) => Promise<any>;
  const sessionId = "session-todo-spec";
  const ctx = (): PluginContext =>
    ({ session: { sessionId, workspacePath: tmpRoot } as any }) as PluginContext;
  const todoFilePath = () =>
    path.join(tmpRoot, ".guada", "todo", `${sessionId}.json`);
  const readFileItems = () =>
    JSON.parse(fs.readFileSync(todoFilePath(), "utf-8")).items;

  beforeAll(async () => {
    execute = await loadTodoExecute();
  });

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "todo-plugin-spec-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("create 合法：content 为格式化列表，meta.items 为新列表，落盘一致", async () => {
    const result = await execute(
      {
        action: "create",
        contents: [
          { step: "第一步", status: "in_progress" },
          { step: "第二步", status: "pending" },
        ],
      },
      ctx(),
    );

    expect(result.content).toBe("[>] 第一步\n[ ] 第二步");
    expect(result.meta).toEqual({
      card: TODO_META_CARD,
      action: "create",
      items: [
        { content: "第一步", status: "in_progress" },
        { content: "第二步", status: "pending" },
      ],
    });
    expect(readFileItems()).toEqual(result.meta.items);
  });

  it("create 非法（两个 in_progress）：content 为错误串，meta.items 为空（文件已清空）", async () => {
    // 先放一份旧待办，验证 create 会先清空
    await execute(
      { action: "create", contents: [{ step: "旧任务", status: "pending" }] },
      ctx(),
    );
    expect(fs.existsSync(todoFilePath())).toBe(true);

    const result = await execute(
      {
        action: "create",
        contents: [
          { step: "A", status: "in_progress" },
          { step: "B", status: "in_progress" },
        ],
      },
      ctx(),
    );

    expect(result.content).toMatch(/^Error:/);
    expect(result.meta).toEqual({
      card: TODO_META_CARD,
      action: "create",
      items: [],
    });
    expect(fs.existsSync(todoFilePath())).toBe(false);
  });

  it("update 合法：全量替换", async () => {
    await execute(
      { action: "create", contents: [{ step: "旧", status: "pending" }] },
      ctx(),
    );

    const result = await execute(
      { action: "update", contents: [{ step: "新", status: "in_progress" }] },
      ctx(),
    );

    expect(result.meta.items).toEqual([
      { content: "新", status: "in_progress" },
    ]);
    expect(readFileItems()).toEqual(result.meta.items);
  });

  it("update 非法：状态不变，meta.items 回传现有持久态", async () => {
    await execute(
      { action: "create", contents: [{ step: "保留", status: "pending" }] },
      ctx(),
    );

    const result = await execute(
      {
        action: "update",
        contents: [
          { step: "A", status: "in_progress" },
          { step: "B", status: "in_progress" },
        ],
      },
      ctx(),
    );

    expect(result.content).toMatch(/^Error:/);
    expect(result.meta.items).toEqual([
      { content: "保留", status: "pending" },
    ]);
    expect(readFileItems()).toEqual([{ content: "保留", status: "pending" }]);
  });

  it("add 合法：追加到现有列表", async () => {
    await execute(
      { action: "create", contents: [{ step: "第一步", status: "in_progress" }] },
      ctx(),
    );

    const result = await execute(
      { action: "add", contents: [{ step: "第二步", status: "pending" }] },
      ctx(),
    );

    expect(result.meta.items).toEqual([
      { content: "第一步", status: "in_progress" },
      { content: "第二步", status: "pending" },
    ]);
  });

  it("add 非法：状态不变", async () => {
    await execute(
      { action: "create", contents: [{ step: "第一步", status: "in_progress" }] },
      ctx(),
    );

    const result = await execute(
      { action: "add", contents: [{ step: "冲突", status: "in_progress" }] },
      ctx(),
    );

    expect(result.content).toMatch(/^Error:/);
    expect(result.meta.items).toEqual([
      { content: "第一步", status: "in_progress" },
    ]);
  });

  it("next：完成当前 in_progress 并启动下一个 pending", async () => {
    await execute(
      {
        action: "create",
        contents: [
          { step: "第一步", status: "in_progress" },
          { step: "第二步", status: "pending" },
        ],
      },
      ctx(),
    );

    const result = await execute({ action: "next" }, ctx());

    expect(result.meta.items).toEqual([
      { content: "第一步", status: "completed" },
      { content: "第二步", status: "in_progress" },
    ]);
    expect(readFileItems()).toEqual(result.meta.items);
  });

  it("全部完成：content 仍显示完成列表，meta.items 为空且文件被删", async () => {
    await execute(
      { action: "create", contents: [{ step: "唯一步骤", status: "in_progress" }] },
      ctx(),
    );

    const result = await execute(
      { action: "update", contents: [{ step: "唯一步骤", status: "completed" }] },
      ctx(),
    );

    expect(result.content).toBe("[x] 唯一步骤");
    expect(result.meta.items).toEqual([]);
    expect(fs.existsSync(todoFilePath())).toBe(false);
  });

  it("meta 不含 images，形状为 { content, meta }", async () => {
    const result = await execute(
      { action: "create", contents: [{ step: "x", status: "pending" }] },
      ctx(),
    );

    expect(Object.keys(result).sort()).toEqual(["content", "meta"]);
    expect(typeof result.content).toBe("string");
  });
});
