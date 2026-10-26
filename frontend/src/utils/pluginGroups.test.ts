import { describe, it, expect } from "vitest";
import { groupPlugins, groupSkills } from "./pluginGroups";
import type { PluginQueryPlugin } from "@/services/modules/settings.api";
import type { Skill } from "@/types/skills";

const plugin = (patch: Partial<PluginQueryPlugin>): PluginQueryPlugin => ({
  pluginId: "p",
  enabled: true,
  toolkits: [],
  ...patch,
});

const skill = (patch: Partial<Skill>): Skill => ({
  id: "s",
  manifest: { name: "s", description: "" },
  source: "global",
  enabled: true,
  ...patch,
});

describe("groupPlugins", () => {
  it("按 category 分成 core/extended/user，空组不返回", () => {
    const groups = groupPlugins([
      plugin({ pluginId: "a", category: "core" }),
      plugin({ pluginId: "b", category: "extended" }),
      plugin({ pluginId: "c", category: "user" }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["core", "extended", "user"]);
    expect(groups[0].items.map((p) => p.pluginId)).toEqual(["a"]);
  });

  it("无 category 时按 source=user/dev 归入用户安装", () => {
    const groups = groupPlugins([
      plugin({ pluginId: "a", source: "user" }),
      plugin({ pluginId: "b", source: "dev" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("user");
    expect(groups[0].items).toHaveLength(2);
  });

  it("无法归类的插件进入 other", () => {
    const groups = groupPlugins([
      plugin({ pluginId: "a", source: "builtin", category: undefined }),
    ]);

    expect(groups).toEqual([{ key: "other", items: [expect.objectContaining({ pluginId: "a" })] }]);
  });

  it("空列表返回空数组", () => {
    expect(groupPlugins([])).toEqual([]);
  });
});

describe("groupSkills", () => {
  it("provider 优先归入插件提供，即使 source=system", () => {
    const groups = groupSkills([
      skill({ id: "a", source: "system", provider: "plugin:skill-bundled" }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["plugin"]);
  });

  it("按 source 分成 builtin/user/shared/workspace", () => {
    const groups = groupSkills([
      skill({ id: "a", source: "system" }),
      skill({ id: "b", source: "global" }),
      skill({ id: "c", source: "agents" }),
      skill({ id: "d", source: "workspace" }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["builtin", "user", "shared", "workspace"]);
    expect(groups.map((g) => g.items[0].id)).toEqual(["a", "b", "c", "d"]);
  });

  it("未知 source 兜底到用户安装", () => {
    const groups = groupSkills([skill({ id: "x", source: "unknown" as Skill["source"] })]);

    expect(groups.map((g) => g.key)).toEqual(["user"]);
  });
});
