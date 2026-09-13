import * as yaml from "js-yaml";

/**
 * 智能体文件（`agents/<id>/AGENT.md`）的映射与校验
 *
 * 文件格式：YAML frontmatter + Markdown 正文
 *   ---
 *   name: 产品经理
 *   description: ...
 *   model: deepseek:deepseek-chat
 *   settings:
 *     memory: { summaryMode: memory_sync }
 *     plugins: { __strategy: deny_nonsystem }
 *     agents: { generic: true }
 *   ---
 *   <systemPrompt 正文>
 *
 * 约定（详见 docs/design/character-file-format.md）：
 * - 目录名 = id，frontmatter 不再写 id；改 name 不改目录名，引用稳定
 * - 正文即 systemPrompt，读入时回填到 settings.systemPrompt，消费方零改动
 * - 其余内部设置原样落 `settings:`，mapper 只做"减法"（挑出 systemPrompt），零语义损失
 * - 不存 id/createdAt/updatedAt/public/group/avatar（分别由目录名、文件系统时间、约定文件名表达）
 */

/** 单个 AGENT.md 的解析结果（未含目录名/文件时间等文件系统事实） */
export interface AgentFileDefinition {
  /** frontmatter name（缺省回退目录名） */
  name: string;
  description?: string;
  /** 模型引用，形如 `{实例id}:{模型名}` */
  model?: string;
  /** 内部设置（已含正文回填的 systemPrompt） */
  settings: Record<string, any>;
}

/** Windows 保留设备名（大小写不敏感，带扩展名同样禁止） */
const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
]);

/** 文件系统非法字符（Windows）与控制字符 */
const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/;
/** 同上，但用于 replace（`g` 标志与 test 的 lastIndex 状态冲突，故分开定义） */
const ILLEGAL_CHARS_GLOBAL = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

export const AGENT_ID_MAX_LENGTH = 100;

/**
 * 由显示名派生目录 id（= id）
 *
 * 保留 Unicode（含中文）以便 `ls agents/` 直接可读；仅剔除文件系统非法字符，
 * 空白折叠为 `-`，去首尾点/横线/空格，超长截断，规避 Windows 保留名。
 */
export function slugifyAgentId(name: string): string {
  let s = (name ?? "").normalize("NFC").trim();
  s = s.replace(ILLEGAL_CHARS_GLOBAL, "");
  s = s.replace(/\s+/g, "-");
  s = s.replace(/^[.\-\s]+|[.\-\s]+$/g, "");
  if (!s) s = "agent";
  if (s.length > AGENT_ID_MAX_LENGTH) s = s.slice(0, AGENT_ID_MAX_LENGTH);
  const stem = s.split(".")[0]?.toUpperCase() ?? s.toUpperCase();
  if (WINDOWS_RESERVED.has(stem)) s = `_${s}`;
  return s;
}

/** 校验 id 是否可作为单层目录名（防路径逃逸） */
export function isValidAgentId(id: string): boolean {
  if (!id || id.length > AGENT_ID_MAX_LENGTH) return false;
  if (id !== id.trim()) return false;
  if (id === "." || id === ".." || id.startsWith(".")) return false;
  if (ILLEGAL_CHARS.test(id)) return false;
  const stem = id.split(".")[0]?.toUpperCase() ?? id.toUpperCase();
  if (WINDOWS_RESERVED.has(stem)) return false;
  return true;
}

/**
 * 解析 AGENT.md
 *
 * 输入宽容：无 frontmatter 时整篇即正文（对应手写文件）；frontmatter 起始
 * 标记未闭合则抛错（交由调用方隔离该文件，不崩服务）。
 */
export function parseAgentMarkdown(
  content: string,
  fallbackName: string,
): AgentFileDefinition {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  let frontmatter: Record<string, any> = {};
  let body = text;

  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (match) {
    const parsed = yaml.load(match[1]);
    if (parsed !== null && parsed !== undefined) {
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("frontmatter 必须是映射（mapping）");
      }
      frontmatter = parsed as Record<string, any>;
    }
    body = match[2] ?? "";
  } else if (text.startsWith("---")) {
    throw new Error("frontmatter 起始标记未闭合");
  }

  const rawSettings = frontmatter.settings;
  const settings: Record<string, any> =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? { ...rawSettings }
      : {};

  const prompt = body.trim();
  if (prompt) settings.systemPrompt = prompt;
  else delete settings.systemPrompt;

  const name =
    typeof frontmatter.name === "string" && frontmatter.name.trim()
      ? frontmatter.name.trim()
      : fallbackName;

  return {
    name,
    description:
      typeof frontmatter.description === "string" && frontmatter.description.trim()
        ? frontmatter.description
        : undefined,
    model:
      typeof frontmatter.model === "string" && frontmatter.model.trim()
        ? frontmatter.model.trim()
        : undefined,
    settings,
  };
}

/** 序列化为 AGENT.md 文本（systemPrompt 抽到正文，其余设置原样落 YAML） */
export function serializeAgentMarkdown(def: AgentFileDefinition): string {
  const settings = { ...(def.settings || {}) };
  const systemPrompt =
    typeof settings.systemPrompt === "string" ? settings.systemPrompt : "";
  delete settings.systemPrompt;

  const frontmatter: Record<string, any> = { name: def.name };
  if (def.description) frontmatter.description = def.description;
  if (def.model) frontmatter.model = def.model;
  if (Object.keys(settings).length > 0) frontmatter.settings = settings;

  const head = yaml
    .dump(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false })
    .trimEnd();
  const body = systemPrompt.trim();

  return `---\n${head}\n---\n${body ? `${body}\n` : ""}`;
}

/** 目录内头像文件的识别（约定：`avatar.<ext>`） */
export const AVATAR_FILE_PREFIX = "avatar.";

export function isAvatarFileName(fileName: string): boolean {
  return (
    fileName.startsWith(AVATAR_FILE_PREFIX) &&
    /^avatar\.(png|jpe?g|webp|gif)$/i.test(fileName)
  );
}
