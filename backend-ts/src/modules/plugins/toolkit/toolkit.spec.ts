import { z } from "zod";
import { Toolkit } from "./toolkit";

/**
 * 工具 schema 展平契约。
 *
 * 展平产物是**发给模型**的 parameters（ToolExecutor.toFlatToolDefs 直接用它），
 * 所以这里钉死的是"模型到底看得见什么"：
 * - 嵌套形状（数组元素对象 / 子对象）必须保留——此前只留顶层 type/description，
 *   模型看不到 {step,status} / options 元素形状，只能靠先验猜（实测写错过）；
 * - 但要有**深度上限**，避免把整棵 schema 灌进提示词；
 * - 标量字段与"缺描述用字段名兜底"等既有行为不能变。
 */
const makeTool = (inputSchema: any, display?: any) => {
  const tk = new Toolkit({ id: "t", name: "t" } as any, "plugin-x");
  tk.registerTool({
    name: "demo",
    description: "demo tool",
    inputSchema,
    execute: async () => "ok",
    display,
  } as any);
  return tk.getTools()[0];
};

describe("Toolkit.registerTool：schema 展平", () => {
  it("保留数组元素对象的形状（items.properties/required/enum）", () => {
    const tool = makeTool(
      z.object({
        action: z.enum(["create", "add"]).describe("动作"),
        contents: z
          .array(
            z.object({
              step: z.string().describe("步骤文本"),
              status: z.enum(["pending", "completed"]).describe("状态"),
            }),
          )
          .optional()
          .describe("待办项"),
      }),
    );

    const contents = tool.parameters.properties.contents as any;
    expect(contents.type).toBe("array");
    expect(contents.description).toBe("待办项");
    expect(contents.items.type).toBe("object");
    expect(contents.items.properties.step).toEqual({
      type: "string",
      description: "步骤文本",
    });
    expect(contents.items.properties.status.enum).toEqual([
      "pending",
      "completed",
    ]);
    expect(contents.items.required).toEqual(["step", "status"]);
  });

  it("标量字段形状不变，且缺描述时用字段名兜底", () => {
    const tool = makeTool(
      z.object({
        file_path: z.string().describe("文件路径"),
        timeout: z.number().optional(),
      }),
    );

    expect(tool.parameters.properties.file_path).toEqual({
      type: "string",
      description: "文件路径",
    });
    // 无描述 → 字段名兜底（原有行为，给模型最低限度的语义锚点）
    expect(tool.parameters.properties.timeout).toEqual({
      type: "number",
      description: "timeout",
    });
    expect(tool.parameters.required).toEqual(["file_path"]);
  });

  it("超过深度上限的子树只留容器类型（不把整棵 schema 灌进提示词）", () => {
    const tool = makeTool(
      z.object({
        level1: z.array(
          z.object({
            level2: z.array(z.object({ level3: z.string().describe("太深了") })),
          }),
        ),
      }),
    );

    const level1 = tool.parameters.properties.level1 as any;
    expect(level1.items.properties.level2.type).toBe("array");
    // 深度截断：不再展开 level3
    expect(level1.items.properties.level2.items).toBeUndefined();
    expect(JSON.stringify(tool.parameters)).not.toContain("太深了");
  });

  it("argsKey 推断仍只看顶层 string 字段（数组字段不会被误选）", () => {
    const tool = makeTool(
      z.object({
        questions: z.array(z.string()),
        q: z.string().describe("查询词"),
      }),
    );
    // 未显式声明 display.argsKey 时，取第一个顶层 string 字段
    expect(tool.parameters.properties.questions.type).toBe("array");
    expect(tool.parameters.properties.q.type).toBe("string");
  });

  it("显式 display.argsKey 优先于推断", () => {
    const tool = makeTool(
      z.object({ q: z.string(), questions: z.array(z.string()) }),
      { text: { executing: "", completed: "" }, argsKey: "questions" },
    );
    // parameters 里两个字段都在（argsKey 只是前端摘要用的声明）
    expect(Object.keys(tool.parameters.properties).sort()).toEqual([
      "q",
      "questions",
    ]);
  });
});
