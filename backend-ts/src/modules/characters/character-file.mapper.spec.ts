import {
  AGENT_ID_MAX_LENGTH,
  isAvatarFileName,
  isValidAgentId,
  parseAgentMarkdown,
  serializeAgentMarkdown,
  slugifyAgentId,
} from "./character-file.mapper";

describe("character-file.mapper", () => {
  describe("slugifyAgentId", () => {
    it("保留中文并按空白分词", () => {
      expect(slugifyAgentId("产品经理")).toBe("产品经理");
      expect(slugifyAgentId("UI Designer")).toBe("UI-Designer");
    });

    it("剔除文件系统非法字符", () => {
      expect(slugifyAgentId('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
      expect(slugifyAgentId("bad\u0000name")).toBe("badname");
    });

    it("去首尾点/横线/空格", () => {
      expect(slugifyAgentId("  .hidden.  ")).toBe("hidden");
      expect(slugifyAgentId("--x--")).toBe("x");
    });

    it("空名回退并规避 Windows 保留名", () => {
      expect(slugifyAgentId("")).toBe("agent");
      expect(slugifyAgentId("   ")).toBe("agent");
      expect(slugifyAgentId("CON")).toBe("_CON");
      expect(slugifyAgentId("com1")).toBe("_com1");
      expect(slugifyAgentId("LPT9")).toBe("_LPT9");
    });

    it("超长截断到上限", () => {
      const id = slugifyAgentId("中".repeat(200));
      expect(id.length).toBe(AGENT_ID_MAX_LENGTH);
    });
  });

  describe("isValidAgentId", () => {
    it("接受普通与中文目录名", () => {
      expect(isValidAgentId("产品经理")).toBe(true);
      expect(isValidAgentId("ui-designer")).toBe(true);
    });

    it("拒绝路径逃逸与非法形态", () => {
      expect(isValidAgentId("")).toBe(false);
      expect(isValidAgentId(".")).toBe(false);
      expect(isValidAgentId("..")).toBe(false);
      expect(isValidAgentId(".hidden")).toBe(false);
      expect(isValidAgentId("a/b")).toBe(false);
      expect(isValidAgentId("a\\b")).toBe(false);
      expect(isValidAgentId(" a")).toBe(false);
      expect(isValidAgentId("CON")).toBe(false);
      expect(isValidAgentId("中".repeat(AGENT_ID_MAX_LENGTH + 1))).toBe(false);
    });
  });

  describe("parseAgentMarkdown", () => {
    it("解析 frontmatter 并把正文作为 systemPrompt", () => {
      const def = parseAgentMarkdown(
        `---
name: 产品经理
description: 需求分析
model: deepseek:deepseek-chat
settings:
  agents:
    generic: true
---
你是一名产品经理。`,
        "fallback",
      );

      expect(def.name).toBe("产品经理");
      expect(def.description).toBe("需求分析");
      expect(def.model).toBe("deepseek:deepseek-chat");
      expect(def.settings.agents).toEqual({ generic: true });
      expect(def.settings.systemPrompt).toBe("你是一名产品经理。");
    });

    it("无 frontmatter 时整篇即正文（手写文件）", () => {
      const def = parseAgentMarkdown("你是一个助手。", "手写助手");
      expect(def.name).toBe("手写助手");
      expect(def.settings.systemPrompt).toBe("你是一个助手。");
    });

    it("缺 name 时回退目录名", () => {
      const def = parseAgentMarkdown("---\ndescription: x\n---\nbody", "目录名");
      expect(def.name).toBe("目录名");
    });

    it("兼容 CRLF 与 BOM", () => {
      const def = parseAgentMarkdown(
        "\uFEFF---\r\nname: A\r\n---\r\n正文",
        "fb",
      );
      expect(def.name).toBe("A");
      expect(def.settings.systemPrompt).toBe("正文");
    });

    it("空正文不产生 systemPrompt 键", () => {
      const def = parseAgentMarkdown("---\nname: A\n---\n", "fb");
      expect(def.settings.systemPrompt).toBeUndefined();
    });

    it("frontmatter 未闭合抛错（交由调用方隔离）", () => {
      expect(() => parseAgentMarkdown("---\nname: A\n正文", "fb")).toThrow();
    });

    it("frontmatter 非映射抛错", () => {
      expect(() => parseAgentMarkdown("---\n- a\n---\nbody", "fb")).toThrow();
    });
  });

  describe("serializeAgentMarkdown", () => {
    it("systemPrompt 抽到正文，其余设置留在 frontmatter", () => {
      const md = serializeAgentMarkdown({
        name: "产品经理",
        description: "desc",
        model: "deepseek:deepseek-chat",
        settings: {
          systemPrompt: "你是一名产品经理。",
          agents: { generic: true },
        },
      });

      expect(md.startsWith("---\n")).toBe(true);
      expect(md).toContain("name: 产品经理");
      expect(md).toContain("model: deepseek:deepseek-chat");
      expect(md).toContain("agents:");
      expect(md).not.toContain("systemPrompt");
      expect(md.trimEnd().endsWith("你是一名产品经理。")).toBe(true);
    });

    it("往返保持语义（含中文长散文）", () => {
      const body = "第一段。\n\n第二段：包含 # 标题与 **强调**。\n";
      const original = {
        name: "编剧",
        description: "角色设计",
        settings: { systemPrompt: body.trim(), memory: { summaryMode: "memory_sync" } },
      };
      const round = parseAgentMarkdown(
        serializeAgentMarkdown(original),
        "fb",
      );

      expect(round.name).toBe(original.name);
      expect(round.settings.systemPrompt).toBe(body.trim());
      expect(round.settings.memory).toEqual({ summaryMode: "memory_sync" });
    });

    it("无设置时不写 settings 键", () => {
      const md = serializeAgentMarkdown({ name: "A", settings: {} });
      expect(md).not.toContain("settings:");
    });
  });

  describe("isAvatarFileName", () => {
    it("只认 avatar.<图片扩展名>", () => {
      expect(isAvatarFileName("avatar.png")).toBe(true);
      expect(isAvatarFileName("avatar.JPG")).toBe(true);
      expect(isAvatarFileName("avatar.webp")).toBe(true);
      expect(isAvatarFileName("avatar.txt")).toBe(false);
      expect(isAvatarFileName("my-avatar.png")).toBe(false);
      expect(isAvatarFileName("AGENT.md")).toBe(false);
    });
  });
});
