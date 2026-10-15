import { AskUserPlugin, ASK_USER_INPUT_SCHEMA, formatAnswers } from "./ask-user.plugin";
import { AskService } from "../../../common/services/ask.service";
import { InteractionWaitService } from "../../../common/services/interaction-wait.service";
import {
  AskDeniedError,
  type AskAnswerItem,
} from "../../../common/types/ask.types";
import type { PluginContext } from "../types/plugin.types";

/**
 * ask_user 工具契约：一次调用带 1–4 题（不是拆成多次调用），答案按稳定 id 回显。
 *
 * 这里钉死四件事：
 * - 卡片元数据（kind='ask' / toolName / toolCallId / 题面映射）与审计、流帧
 * - 答案回流文案的三种形态（全答 / 部分作答 / 空作答）与"自定义文本是答案不是拒绝"
 * - 取消（abort）走 AskDeniedError('cancelled')，交给 ToolExecutor 转 isError
 * - 能力声明：计划模式放行、子代理不可见、阻塞人类交互
 */

/** 假 AskSession：只实现 AskService 用到的三个方法 */
function makeSession(sessionId = "s-ask") {
  const asked: any[] = [];
  const answered: any[] = [];
  const stream: any[] = [];
  return {
    sessionId,
    asked,
    answered,
    stream,
    appendAskAsked: async (d: any) => {
      asked.push(d);
    },
    appendAskAnswered: async (d: any) => {
      answered.push(d);
    },
    publishStream: async (c: any) => {
      stream.push(c);
    },
  };
}

const last = <T>(arr: T[]): T => arr[arr.length - 1];

async function loadTool() {
  const wait = new InteractionWaitService();
  const askService = new AskService(wait);
  const plugin = new AskUserPlugin(askService);
  let tool: any;
  let kit: any;
  const api: any = {
    registerNls: () => {},
    registerToolKit: (def: any) => {
      kit = def;
      return {
        registerTool: (toolDef: any) => {
          tool = toolDef;
        },
      };
    },
  };
  await plugin.onLoad(api);
  return { wait, tool, kit };
}

/** 轮询到待答出现（ask 的注册链是异步的，但同步栈内很快） */
async function pendingOf(wait: InteractionWaitService, sessionId: string) {
  for (let i = 0; i < 50; i++) {
    const pending = wait.listPending(sessionId);
    if (pending.length > 0) return pending[0];
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("no pending ask registered");
}

const QUESTION_FIXTURES = [
  {
    question: "用哪种认证方式？",
    options: ["OAuth", "JWT"],
  },
  {
    question: "需要哪些能力？",
    options: ["A", "B"],
    multiSelect: true,
  },
  {
    question: "先部署到哪？",
    options: ["本地", "云端"],
  },
];

describe("AskUserPlugin / ask_user", () => {
  it("一次调用 3 题：卡片元数据、题面映射、审计与 ask_requested 帧", async () => {
    const { wait, tool } = await loadTool();
    const session = makeSession();
    const ctx = { session, toolCallId: "tc-1" } as unknown as PluginContext;

    const promise = tool.execute({ questions: QUESTION_FIXTURES }, ctx);
    const pending = await pendingOf(wait, session.sessionId);

    expect(pending.kind).toBe("ask");
    expect(pending.toolName).toBe("ask_user");
    expect(pending.toolCallId).toBe("tc-1");
    expect(pending.title).toBe("需要你的确认");
    // 一次 ask = 一个 requestId 带 3 题，答案按 q1..q3 回显
    expect(pending.questions.map((q: any) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(pending.questions[0].question).toBe("用哪种认证方式？");
    expect(pending.questions[1].multiSelect).toBe(true);
    // 无 header/detail：对外只有 question/options/multiSelect 三个字段
    expect(pending.questions[0].detail).toBeUndefined();
    // 对外是裸字符串，落到内部契约 AskOption（label 即答案值）
    expect(pending.questions[0].options).toEqual([
      { label: "OAuth" },
      { label: "JWT" },
    ]);

    // 审计先写、再发帧
    expect(session.asked).toHaveLength(1);
    expect(last(session.stream)).toMatchObject({
      type: "ask_requested",
      requestId: pending.requestId,
    });

    wait.resolveAnswers(session.sessionId, pending.requestId, [
      { id: "q1", selected: ["OAuth"] },
      { id: "q2", selected: ["A", "B"] },
      { id: "q3", selected: [], custom: "先本地后云" },
    ]);
    const result = await promise;

    expect(result.content).toContain('"用哪种认证方式？"="OAuth"');
    expect(result.content).toContain('"需要哪些能力？"="A, B"'); // 多选按序拼接
    expect(result.content).toContain('"先部署到哪？"="先本地后云"'); // 自定义文本 = 正常答案
    expect(result.content).toMatch(/^User has answered your questions:/);

    expect(last(session.answered)).toMatchObject({
      requestId: pending.requestId,
      answers: expect.any(Array),
    });
    expect(last(session.stream)).toMatchObject({
      type: "ask_resolved",
      outcome: "answered",
    });
  });

  it("部分作答：明确告知跳过数，并禁止编造用户偏好", async () => {
    const { wait, tool } = await loadTool();
    const session = makeSession();
    const promise = tool.execute(
      { questions: QUESTION_FIXTURES },
      { session } as unknown as PluginContext,
    );
    const pending = await pendingOf(wait, session.sessionId);
    // q2 无答案（既无选项也无自定义）
    wait.resolveAnswers(session.sessionId, pending.requestId, [
      { id: "q1", selected: ["OAuth"] },
      { id: "q2", selected: [] },
      { id: "q3", selected: ["云端"] },
    ]);

    const result = await promise;
    expect(result.content).toContain("skipped 1");
    expect(result.content).toContain('"用哪种认证方式？"="OAuth"');
    expect(result.content).toContain("do not invent user preferences");
  });

  it("空作答：不视为拒绝，也不编造偏好", async () => {
    const { wait, tool } = await loadTool();
    const session = makeSession();
    const promise = tool.execute(
      { questions: [QUESTION_FIXTURES[0]] },
      { session } as unknown as PluginContext,
    );
    const pending = await pendingOf(wait, session.sessionId);
    wait.resolveAnswers(session.sessionId, pending.requestId, [
      { id: "q1", selected: [] },
    ]);

    const result = await promise;
    expect(result.content).toBe(
      "The user did not provide answers to these questions. Continue using your best judgment; " +
        "do not treat this as a rejection or invent a user preference.",
    );
  });

  it("取消（用户停止）：抛 AskDeniedError('cancelled')，并收口为 ask_resolved(cancelled)", async () => {
    const { wait, tool } = await loadTool();
    const session = makeSession();
    const controller = new AbortController();
    const promise = tool.execute(
      { questions: QUESTION_FIXTURES },
      { session } as unknown as PluginContext,
      controller.signal,
    );
    const pending = await pendingOf(wait, session.sessionId);

    controller.abort();

    await expect(promise).rejects.toBeInstanceOf(AskDeniedError);
    await expect(promise).rejects.toMatchObject({ outcome: "cancelled" });
    expect(wait.listPending(session.sessionId)).toHaveLength(0);
    expect(last(session.stream)).toMatchObject({
      type: "ask_resolved",
      requestId: pending.requestId,
      outcome: "cancelled",
    });
    expect(last(session.answered)).toMatchObject({
      requestId: pending.requestId,
      cancelled: true,
    });
  });

  it("对外形态：选项就是裸字符串；工具文档只讲字符串，不提对象", async () => {
    const { tool } = await loadTool();
    // 一行示例胜过散落的字段说明（模型对示例的遵循度最高）
    expect(tool.description).toContain(
      '"options":["Postgres (Recommended)","SQLite","MySQL"]',
    );
    // 暴露给模型的定义只保留最简形态：不再出现 label/description 那套对象形状
    expect(tool.description).not.toContain('"label"');
    expect(tool.description).not.toContain("## Option shape");
  });

  it("行展示：只报问题数、不展示回答；文案走 NLS 而非写死中文", async () => {
    const { tool, kit } = await loadTool();

    // 计数来源 = questions 数组长度，单位由 NLS 下发 → 前端渲染「已询问用户 3 个问题」
    expect(tool.display.argsKey).toBe("questions");
    expect(tool.display.argsCountUnit).toBe("%askUser.display.questionsUnit%");
    // 文案走 %key%（zh/en 两份语言包），不再写死中文
    expect(tool.display.text.executing).toBe("%askUser.display.executing%");
    expect(tool.display.text.completed).toBe("%askUser.display.completed%");
    expect(tool.display.aggregate.completed).toBe(
      "%askUser.display.aggregateCompleted%",
    );
    expect(kit.name).toBe("%askUser.name%");
    // 回答不进行文案：答案由工具结果承载，展开可见
    expect(tool.display.text.completed).not.toContain("回答");
  });

  it("能力声明：计划模式放行 + 只读 + 阻塞人类 + 子代理不可见", async () => {
    const { tool, kit } = await loadTool();

    expect(tool.name).toBe("ask_user");
    // 计划模式下"问清需求"正是本工具主场，必须放行（否则被计划门硬拒）
    expect(tool.allowedInPlanMode).toBe(true);
    expect(tool.readOnly).toBe(true);
    // 子会话放行会把卡挂到用户看不见的地方 → 卡死父回合
    expect(tool.requiresUserInteraction).toBe(true);

    const sub = await kit.handler({ session: { sessionType: "sub_agent" } } as any);
    expect(sub).toEqual({ loadMode: "none" });
    const web = await kit.handler({ session: { sessionType: "web" } } as any);
    expect(web).toEqual({});
  });
});

describe("ask_user 入参 schema 边界", () => {
  const q = (text: string) => ({
    question: text,
    options: ["A", "B"],
  });

  it("1–4 题合法", () => {
    expect(ASK_USER_INPUT_SCHEMA.safeParse({ questions: [q("Q1")] }).success).toBe(true);
    expect(
      ASK_USER_INPUT_SCHEMA.safeParse({
        questions: [q("Q1"), q("Q2"), q("Q3"), q("Q4")],
      }).success,
    ).toBe(true);
  });

  it("5 题被拒（一次调用最多 4 题；多问题要合并进一次调用）", () => {
    const result = ASK_USER_INPUT_SCHEMA.safeParse({
      questions: [q("Q1"), q("Q2"), q("Q3"), q("Q4"), q("Q5")],
    });
    expect(result.success).toBe(false);
  });

  it("0 题被拒", () => {
    expect(ASK_USER_INPUT_SCHEMA.safeParse({ questions: [] }).success).toBe(false);
  });

  it("同一次调用内问题文本重复被拒（答案按题序回显，重复会串题）", () => {
    const result = ASK_USER_INPUT_SCHEMA.safeParse({
      questions: [q("同一个问题"), q("同一个问题")],
    });
    expect(result.success).toBe(false);
  });

  it("选项少于 2 个被拒", () => {
    const result = ASK_USER_INPUT_SCHEMA.safeParse({
      questions: [{ question: "Q", options: [{ label: "唯一选项" }] }],
    });
    expect(result.success).toBe(false);
  });

  it("选项形态：只收裸字符串（对象形态已移除，不再有隐形容错）", () => {
    // 唯一合法形态
    expect(
      ASK_USER_INPUT_SCHEMA.safeParse({
        questions: [{ question: "Q", options: ["A", "B", "C"] }],
      }).success,
    ).toBe(true);
    // 空字符串不是有意义的选项
    expect(
      ASK_USER_INPUT_SCHEMA.safeParse({
        questions: [{ question: "Q", options: ["", "B"] }],
      }).success,
    ).toBe(false);
    // 对象形态不再被接受：形状契约由工具 description（含 JSON 示例）承载
    expect(
      ASK_USER_INPUT_SCHEMA.safeParse({
        questions: [{ question: "Q", options: [{ label: "A" }, { label: "B" }] }],
      }).success,
    ).toBe(false);
  });

  it("对外字段面：只有 question / options / multiSelect（header 已删除）", () => {
    const parsed = ASK_USER_INPUT_SCHEMA.safeParse({
      questions: [
        {
          question: "Q",
          options: ["A", "B"],
          multiSelect: false,
          // 旧字段：schema 非 strict，多传的键被剥离而不是报错（宽容）
          header: "Legacy",
        },
      ],
    });
    expect(parsed.success).toBe(true);
    expect(Object.keys(parsed.data!.questions[0]).sort()).toEqual([
      "multiSelect",
      "options",
      "question",
    ]);
  });
});

describe("formatAnswers 单元", () => {
  const questions = [
    { question: "Q1" },
    { question: "Q2" },
  ];

  it("自定义文本优先于选项（纯询问语义下它是答案，不是拒绝）", () => {
    const answers: AskAnswerItem[] = [
      { id: "q1", selected: ["A"], custom: "用 Kerberos" },
      { id: "q2", selected: ["C", "D"] },
    ];
    const text = formatAnswers(questions, answers);
    expect(text).toContain('"Q1"="用 Kerberos"');
    expect(text).not.toContain('"Q1"="A"');
    expect(text).toContain('"Q2"="C, D"');
  });

  it("自定义文本仅为空白时回退到选项", () => {
    const text = formatAnswers(questions, [
      { id: "q1", selected: ["B"], custom: "   " },
    ]);
    expect(text).toContain('"Q1"="B"');
  });
});
