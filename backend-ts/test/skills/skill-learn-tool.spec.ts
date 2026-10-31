import { SkillPlugin } from "../../src/modules/skills/plugins/skill.plugin";
import { SKILL_LEARN_MAX_CHARS } from "../../src/modules/skills/common/skill-location.util";

/**
 * skill_learn 工具的行为：正文必须带技能位置头（模型据此执行自带脚本），
 * 且自管长度——超限时截断并给出续读路径，而不是被通用裁剪换成预览。
 */

/** 最小 fake PluginApi：只捕获工具/提示词注册，不触碰 Nest 容器 */
function makeApi() {
  const captured: { tools: any[]; prompts: any[] } = { tools: [], prompts: [] };
  const kit = {
    registerTool: (def: any) => captured.tools.push(def),
    registerPrompt: (def: any) => captured.prompts.push(def),
  };
  const api = {
    registerNls: () => {},
    registerCommandProvider: () => {},
    registerToolKit: () => kit,
  } as any;
  return { api, captured };
}

/** 造一个 onLoad 后可取用的 skill_learn 定义 */
async function loadSkillLearn(skillLearnResult: any) {
  const orchestrator = {
    listSkills: () => [],
    skillLearn: jest.fn().mockResolvedValue(skillLearnResult),
  } as any;
  const plugin = new SkillPlugin(orchestrator);
  const { api, captured } = makeApi();
  await plugin.onLoad(api);
  const tool = captured.tools.find((t) => t.name === "skill_learn");
  return { tool, orchestrator };
}

describe("skill_learn 工具", () => {
  it("返回正文带位置头：文件型技能给出技能目录", async () => {
    const { tool } = await loadSkillLearn({
      name: "my-skill",
      content: "步骤一：运行脚本",
      path: "/s/my-skill/SKILL.md",
      resourceBase: { kind: "directory", path: "/s/my-skill" },
      baseDirectory: "/s/my-skill",
      skillMdPath: "/s/my-skill/SKILL.md",
    });

    const res = await tool.execute({ name: "my-skill" }, {});

    expect(res.content).toContain("Base directory for this skill: /s/my-skill");
    expect(res.content).toContain("步骤一：运行脚本");
  });

  it("插件注册型技能：位置头指向共享资源目录（脚本所在处）", async () => {
    const { tool } = await loadSkillLearn({
      name: "skill-creator",
      content: "运行 node scripts/validate-skill.mjs",
      path: "/app/bundled-skills",
      resourceBase: { kind: "directory", path: "/app/bundled-skills" },
      baseDirectory: "/app/bundled-skills",
      skillMdPath: null,
    });

    const res = await tool.execute({ name: "skill-creator" }, {});

    expect(res.content).toContain(
      "Base directory for this skill: /app/bundled-skills",
    );
  });

  it("超长正文：自截断并附续读路径，而非依赖通用裁剪", async () => {
    const { tool } = await loadSkillLearn({
      name: "huge",
      content: "z".repeat(SKILL_LEARN_MAX_CHARS + 500),
      path: "/s/huge/SKILL.md",
      resourceBase: { kind: "directory", path: "/s/huge" },
      baseDirectory: "/s/huge",
      skillMdPath: "/s/huge/SKILL.md",
    });

    const res = await tool.execute({ name: "huge" }, {});

    expect(res.content).toContain("Instructions truncated at");
    expect(res.content).toContain("file_path=/s/huge/SKILL.md");
  });

  it("未知技能：抛错", async () => {
    const { tool } = await loadSkillLearn(null);
    await expect(tool.execute({ name: "nope" }, {})).rejects.toThrow(
      'skill "nope" not found',
    );
  });

  it("声明 exemptFromLargeResult，避免正文被通用大结果处理替换", async () => {
    const { tool } = await loadSkillLearn({
      name: "my-skill",
      content: "正文",
      path: "/s/my-skill/SKILL.md",
      resourceBase: { kind: "directory", path: "/s/my-skill" },
      baseDirectory: "/s/my-skill",
      skillMdPath: "/s/my-skill/SKILL.md",
    });

    expect(tool.exemptFromLargeResult).toBe(true);
  });
});

/**
 * 技能清单 prompt 的门控契约。
 *
 * 智能体设置 → Skills 的「功能开关」（settings.plugins.skill = { toolkits_filter:
 * 'allow' } 空允许列表）只隐藏真实技能段（# Skills），不影响 skill_learn 工具
 * 本身与懒加载工具包段（<available_tool_skills>）——后者由「本地工具」tab 的
 * 工具包开关（loadMode）控制，职责分离。
 */
describe("技能清单 prompt 门控", () => {
  const realSkill = {
    id: "skill-a",
    manifest: { name: "skill-a", description: "真实技能 A" },
    enabled: true,
  };
  const toolKitEntry = {
    id: "workflow",
    name: "workflow",
    activator: "workflow 编排",
    pluginId: "workflow",
  };

  async function loadPromptContent(session: any) {
    const orchestrator = {
      listSkills: jest.fn().mockReturnValue([realSkill]),
      listToolSkills: jest.fn().mockReturnValue([toolKitEntry]),
      skillLearn: jest.fn(),
    } as any;
    const plugin = new SkillPlugin(orchestrator);
    const { api, captured } = makeApi();
    await plugin.onLoad(api);
    const prompt = captured.prompts.find(
      (p: any) => p.description === "可用技能列表",
    );
    expect(prompt).toBeDefined();
    const content = await prompt.content({ session } as any);
    return { content, orchestrator };
  }

  const sessionWith = (plugins: any, skills?: any) =>
    ({
      workspacePath: undefined,
      getSettings: (key: string) =>
        key === "plugins" ? plugins : key === "skills" ? skills : undefined,
    }) as any;

  it("无门控配置时：真实技能段与工具包段都在", async () => {
    const { content, orchestrator } = await loadPromptContent(
      sessionWith(undefined),
    );

    expect(content).toContain("# Skills");
    expect(content).toContain("<available_skills>");
    expect(content).toContain("skill-a");
    expect(content).toContain("<available_tool_skills>");
    expect(content).toContain("workflow");
    expect(orchestrator.listToolSkills).toHaveBeenCalled();
  });

  it("功能开关关闭（空 allow 列表）：真实技能段消失，工具包段保留", async () => {
    const { content } = await loadPromptContent(
      sessionWith({ skill: { toolkits_filter: "allow" } }),
    );

    expect(content).not.toContain("# Skills");
    expect(content).not.toContain("<available_skills>");
    expect(content).toContain("<available_tool_skills>");
    expect(content).toContain("workflow");
  });

  it("功能开关开启（allow 含 skill）：两段都在", async () => {
    const { content } = await loadPromptContent(
      sessionWith({
        skill: { toolkits_filter: "allow", toolkits_allow: ["skill"] },
      }),
    );

    expect(content).toContain("# Skills");
    expect(content).toContain("<available_tool_skills>");
  });

  it("黑名单 deny skill：同样只隐藏真实技能段", async () => {
    const { content } = await loadPromptContent(
      sessionWith({ skill: { toolkits_deny: ["skill"] } }),
    );

    expect(content).not.toContain("# Skills");
    expect(content).toContain("<available_tool_skills>");
  });
});
