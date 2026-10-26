/// <reference types="jest" />

import {
  createWorkflowCommandProvider,
  normalizeWorkflowCommandInput,
  type WorkflowAvailability,
} from "../../src/modules/workflow/workflow.command";
import { WorkflowPlugin } from "../../src/modules/workflow/workflow.plugin";

const TAG = '[/workflow:workflow label="工作流"]';

function makeProvider(opts?: {
  enabled?: boolean;
  availability?: WorkflowAvailability;
}) {
  return createWorkflowCommandProvider({
    isEnabled: () => opts?.enabled ?? true,
    resolveAvailability: async () => opts?.availability ?? "available",
  });
}

async function loadPluginProvider(sessionService: any) {
  const plugin = new WorkflowPlugin({} as any, {} as any, sessionService);
  const providers: any[] = [];
  const kit = { registerTool: jest.fn(), registerPrompt: jest.fn() };
  const api = {
    registerNls: jest.fn(),
    registerCommandProvider: (provider: any) => providers.push(provider),
    registerToolKit: () => kit,
  };
  await plugin.onLoad(api as any);
  expect(providers).toHaveLength(1);
  return providers[0];
}

describe("normalizeWorkflowCommandInput", () => {
  it("裸命令（含大小写/前后空白）规范化为标签", () => {
    expect(normalizeWorkflowCommandInput("/workflow")).toBe(TAG);
    expect(normalizeWorkflowCommandInput("  /WORKFLOW  ")).toBe(TAG);
  });

  it("带任务时保留任务文本（含多行）", () => {
    expect(normalizeWorkflowCommandInput("/workflow 审查整个仓库")).toBe(
      `${TAG} 审查整个仓库`,
    );
    expect(
      normalizeWorkflowCommandInput("/workflow\n审查仓库\n输出报告"),
    ).toBe(`${TAG} 审查仓库\n输出报告`);
  });

  it("非整段命令不误改", () => {
    expect(normalizeWorkflowCommandInput("请解释 /workflow 的用法")).toBe(
      "请解释 /workflow 的用法",
    );
    expect(normalizeWorkflowCommandInput("/workflowx")).toBe("/workflowx");
    expect(normalizeWorkflowCommandInput(`${TAG} 任务`)).toBe(`${TAG} 任务`);
    expect(normalizeWorkflowCommandInput("/compact")).toBe("/compact");
  });
});

describe("WorkflowCommandProvider", () => {
  it("启用时暴露一个 workflow 斜杠命令项", async () => {
    const provider = makeProvider();
    expect(provider.id).toBe("workflow");
    expect(provider.trigger).toBe("slash");

    const items = await provider.fetchItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "workflow", label: "工作流" });
    expect(items[0].description).toContain("子代理");
  });

  it("插件全局禁用时不暴露、不注入", async () => {
    const provider = makeProvider({ enabled: false });
    expect(await provider.fetchItems()).toEqual([]);
    await expect(
      provider.parse({ name: "workflow" }, { sessionId: "s1" }),
    ).resolves.toBeUndefined();
  });

  it("可用时注入显式请求与 tool_learn/workflow_run 指引", async () => {
    const result = await makeProvider({ availability: "available" }).parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain("explicitly invoked the /workflow");
    expect(result?.appendix).toContain('tool_learn("workflow")');
    expect(result?.appendix).toContain("workflow_run");
  });

  it("unknown 按可用处理（fail-open）", async () => {
    const result = await makeProvider({ availability: "unknown" }).parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain('tool_learn("workflow")');
  });

  it("可用性查询抛错时 fail-open", async () => {
    const provider = createWorkflowCommandProvider({
      isEnabled: () => true,
      resolveAvailability: async () => {
        throw new Error("boom");
      },
    });
    const result = await provider.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain('tool_learn("workflow")');
  });

  it.each([
    ["no_agents", "Sub-agents"],
    ["toolkit_disabled", "Toolkits"],
  ] as const)("%s 分支给出对应设置引导且不指示调用 workflow_run", async (availability, hint) => {
    const result = await makeProvider({ availability }).parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain(hint);
    expect(result?.appendix).toContain("Do not call workflow_run");
    expect(result?.appendix).not.toContain('tool_learn("workflow")');
  });

  it("sub_agent 分支说明不能嵌套", async () => {
    const result = await makeProvider({ availability: "sub_agent" }).parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain("sub-agent session");
    expect(result?.appendix).toContain("Do not call workflow_run");
    expect(result?.appendix).not.toContain('tool_learn("workflow")');
  });
});

describe("WorkflowPlugin /workflow 可用性解析", () => {
  it("onLoad 注册 id=workflow、trigger=slash 的 provider", async () => {
    const provider = await loadPluginProvider({
      getSessionById: jest.fn(),
    });
    expect(provider.id).toBe("workflow");
    expect(provider.trigger).toBe("slash");
    expect(await provider.fetchItems({})).toHaveLength(1);
  });

  it("无启用子代理 → no_agents", async () => {
    const provider = await loadPluginProvider({
      getSessionById: async () => ({
        sessionType: "chat",
        settings: {},
        agent: { settings: { agents: { __default: false } } },
      }),
    });
    const result = await provider.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain("Sub-agents");
  });

  it("启用子代理 → available", async () => {
    const provider = await loadPluginProvider({
      getSessionById: async () => ({
        sessionType: "chat",
        settings: {},
        agent: { settings: { agents: { generic: true } } },
      }),
    });
    const result = await provider.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain('tool_learn("workflow")');
  });

  it("智能体禁用 workflow 工具包 → toolkit_disabled", async () => {
    const provider = await loadPluginProvider({
      getSessionById: async () => ({
        sessionType: "chat",
        settings: {
          plugins: { workflow: { toolkits_filter: "deny_all" } },
          agents: { generic: true },
        },
        agent: { settings: {} },
      }),
    });
    const result = await provider.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain("Toolkits");
  });

  it("子代理会话 → sub_agent", async () => {
    const provider = await loadPluginProvider({
      getSessionById: async () => ({
        sessionType: "sub_agent",
        settings: { agents: { generic: true } },
        agent: { settings: {} },
      }),
    });
    const result = await provider.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(result?.appendix).toContain("sub-agent session");
  });

  it("会话查不到/查询抛错 → unknown（fail-open）", async () => {
    const missing = await loadPluginProvider({
      getSessionById: async () => null,
    });
    const missingResult = await missing.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(missingResult?.appendix).toContain('tool_learn("workflow")');

    const failing = await loadPluginProvider({
      getSessionById: async () => {
        throw new Error("db down");
      },
    });
    const failingResult = await failing.parse(
      { name: "workflow" },
      { sessionId: "s1" },
    );
    expect(failingResult?.appendix).toContain('tool_learn("workflow")');
  });
});
