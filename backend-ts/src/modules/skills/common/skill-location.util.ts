import { SkillResourceBase } from "../interfaces/skill-manifest.interface";
import { safeTruncate } from "../../../common/utils/string.utils";

/**
 * skill_learn 正文的自管上限（字符数）。
 *
 * skill_learn 声明了 exemptFromLargeResult，不走执行器的通用裁剪，因此必须自带上限：
 * 内置最大的技能 skill-creator 约 19.4KB，这里留约 3× 余量；超出即截断并给出续读路径。
 */
export const SKILL_LEARN_MAX_CHARS = 60000;

/** 技能位置信息：模型据此执行技能自带脚本、读取随附资源 */
export interface SkillLocation {
  resourceBase: SkillResourceBase | null;
  /** 脚本/资源根目录；来源未知时为 null（不编造路径） */
  baseDirectory: string | null;
  /** 文件型技能的 SKILL.md 绝对路径；插件注册型（无磁盘文件）为 null */
  skillMdPath: string | null;
}

/**
 * 生成置于技能正文最前的位置头。
 *
 * 必须放在正文开头：即使结果被通用大结果处理 spill，2048 字符的预览里也能看到路径，
 * 模型才能据此定位脚本目录或继续 read 完整文件。
 */
export function formatSkillLocationHeader(loc: SkillLocation): string {
  // 具体目录优先于 URL：本地目录对模型的文件工具最可执行。
  if (loc.baseDirectory) {
    return [
      `Base directory for this skill: ${loc.baseDirectory}`,
      "Scripts and referenced resources live under this directory.",
    ].join("\n");
  }
  const rb = loc.resourceBase;
  if (rb?.kind === "url") return `Skill resource location: ${rb.url}`;
  if (rb?.kind === "opaque") return `Skill resource location: ${rb.description}`;
  return "This skill declares no resource directory (no bundled scripts/resources).";
}

/**
 * 超长正文截断，并给出续读指引。
 *
 * 有磁盘文件（skillMdPath）时按 read 工具的风格给出 file_path/unit/offset/limit；
 * 插件注册型技能没有文件可读，如实说明而不是编造路径。
 */
export function truncateSkillInstructions(
  content: string,
  loc: Pick<SkillLocation, "skillMdPath" | "baseDirectory">,
  maxChars: number = SKILL_LEARN_MAX_CHARS,
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };

  const head = safeTruncate(content, maxChars);
  const note = loc.skillMdPath
    ? [
        `(Instructions truncated at ${maxChars} chars.)`,
        `Full skill file: ${loc.skillMdPath} — continue with the read tool:`,
        `  file_path=${loc.skillMdPath}, unit="char", offset=${maxChars}, limit=20000`,
      ].join("\n")
    : [
        `(Instructions truncated at ${maxChars} chars.)`,
        "This skill is plugin-registered and has no file on disk to read further.",
      ].join("\n");

  return { content: `${head}\n\n${note}`, truncated: true };
}
