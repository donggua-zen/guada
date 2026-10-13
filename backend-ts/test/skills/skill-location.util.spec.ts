import {
  formatSkillLocationHeader,
  truncateSkillInstructions,
  SKILL_LEARN_MAX_CHARS,
} from "../../src/modules/skills/common/skill-location.util";

describe("skill-location.util", () => {
  describe("formatSkillLocationHeader", () => {
    it("文件型技能：输出 Base directory 与脚本提示", () => {
      const header = formatSkillLocationHeader({
        resourceBase: {
          kind: "directory",
          path: "/home/u/.guada/skills/my-skill",
        },
        baseDirectory: "/home/u/.guada/skills/my-skill",
        skillMdPath: "/home/u/.guada/skills/my-skill/SKILL.md",
      });

      expect(header).toContain(
        "Base directory for this skill: /home/u/.guada/skills/my-skill",
      );
      expect(header).toContain(
        "Scripts and referenced resources live under this directory.",
      );
    });

    it("内置/插件注册型：resourceBase 目录即资源根", () => {
      const header = formatSkillLocationHeader({
        resourceBase: { kind: "directory", path: "/app/bundled-skills" },
        baseDirectory: "/app/bundled-skills",
        skillMdPath: null,
      });

      expect(header).toContain(
        "Base directory for this skill: /app/bundled-skills",
      );
    });

    it("url 型：输出资源 URL", () => {
      const header = formatSkillLocationHeader({
        resourceBase: { kind: "url", url: "https://example.com/skill" },
        baseDirectory: null,
        skillMdPath: null,
      });

      expect(header).toBe("Skill resource location: https://example.com/skill");
    });

    it("opaque 型：输出描述", () => {
      const header = formatSkillLocationHeader({
        resourceBase: { kind: "opaque", description: "见内部文档" },
        baseDirectory: null,
        skillMdPath: null,
      });

      expect(header).toBe("Skill resource location: 见内部文档");
    });

    it("无任何来源：如实说明未声明资源目录，且不出现假路径", () => {
      const header = formatSkillLocationHeader({
        resourceBase: null,
        baseDirectory: null,
        skillMdPath: null,
      });

      expect(header).toContain("declares no resource directory");
      expect(header).not.toContain("__plugin__");
    });

    it("目录优先于 url：本地目录对模型的文件工具更可执行", () => {
      const header = formatSkillLocationHeader({
        resourceBase: { kind: "url", url: "https://example.com/x" },
        baseDirectory: "/local/skill",
        skillMdPath: null,
      });

      expect(header).toContain("Base directory for this skill: /local/skill");
      expect(header).not.toContain("https://example.com/x");
    });
  });

  describe("truncateSkillInstructions", () => {
    it("未超限：原样返回，不追加提示", () => {
      const r = truncateSkillInstructions("短正文", {
        skillMdPath: null,
        baseDirectory: null,
      });

      expect(r).toEqual({ content: "短正文", truncated: false });
    });

    it("超限且有磁盘文件：截断并给出 read 续读参数", () => {
      const long = "x".repeat(SKILL_LEARN_MAX_CHARS + 100);
      const r = truncateSkillInstructions(long, {
        skillMdPath: "/s/my-skill/SKILL.md",
        baseDirectory: "/s/my-skill",
      });

      expect(r.truncated).toBe(true);
      expect(r.content).toContain(
        `(Instructions truncated at ${SKILL_LEARN_MAX_CHARS} chars.)`,
      );
      expect(r.content).toContain("file_path=/s/my-skill/SKILL.md");
      expect(r.content).toContain('unit="char"');
      expect(r.content).toContain(`offset=${SKILL_LEARN_MAX_CHARS}`);
      // 头部保留、尾部被裁
      expect(r.content.startsWith("x")).toBe(true);
    });

    it("超限且无磁盘文件：如实说明，不编造路径", () => {
      const long = "y".repeat(SKILL_LEARN_MAX_CHARS + 1);
      const r = truncateSkillInstructions(long, {
        skillMdPath: null,
        baseDirectory: "/app/bundled-skills",
      });

      expect(r.truncated).toBe(true);
      expect(r.content).toContain("plugin-registered and has no file on disk");
      expect(r.content).not.toContain("file_path=");
    });

    it("上限可自定义", () => {
      const r = truncateSkillInstructions(
        "0123456789",
        { skillMdPath: null, baseDirectory: null },
        4,
      );

      expect(r.truncated).toBe(true);
      expect(r.content.startsWith("0123")).toBe(true);
    });
  });
});
