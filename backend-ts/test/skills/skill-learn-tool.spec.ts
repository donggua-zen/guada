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
